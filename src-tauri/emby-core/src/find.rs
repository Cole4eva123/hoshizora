//! Where a 服务器 answers: the addresses to try from what was typed, probed https first, following redirects.

use std::time::Duration;

use reqwest::Client;
use serde::Deserialize;
use tokio::task::JoinSet;
use url::Url;

use crate::{Emby, Error};

// How long a probe may take. https gets 2 s before http is tried, so a password goes in the clear only to a server
// whose https is missing or that slow: a home server's IP mostly turns https down at once, and the wait is for a
// firewall that drops rather than refuses.
const PROBE_HTTPS: Duration = Duration::from_secs(2);
const PROBE_HTTP: Duration = Duration::from_secs(5);

// Who answered a probe: the server's id and the name it gives itself.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Info {
    pub(crate) id: String,
    pub(crate) server_name: String,
}

impl Emby {
    // Where the server typed answers, and who it is. The addresses to try come from what was typed (`candidates`): the
    // https ones are asked at once, and the http ones only once none of those answers. A redirect, as from a proxy's
    // http to its https, is followed, and the address it lands at is the one found.
    pub(crate) async fn find(&self, typed: &str) -> Result<(String, Info), Error> {
        let addresses = candidates(typed).ok_or(Error::NotAnAddress)?;
        match self.race(&addresses, "https:", PROBE_HTTPS).await {
            Some(found) => Ok(found),
            None => self.race(&addresses, "http:", PROBE_HTTP).await.ok_or(Error::Offline),
        }
    }

    // The first of `addresses` with `scheme` where Emby answers, all asked at once: where it landed, and who it is.
    async fn race(&self, addresses: &[String], scheme: &str, timeout: Duration) -> Option<(String, Info)> {
        let mut probes = JoinSet::new();
        for address in addresses.iter().filter(|a| a.starts_with(scheme)) {
            probes.spawn(probe(self.probing.clone(), address.clone(), timeout));
        }
        while let Some(done) = probes.join_next().await {
            if let Ok(Some(found)) = done {
                return Some(found);
            }
        }
        None
    }
}

// Whether Emby answers at `address`, following any redirect: where it landed, and who it is.
async fn probe(http: Client, address: String, timeout: Duration) -> Option<(String, Info)> {
    let answer = http.get(format!("{address}/System/Info/Public")).timeout(timeout).send().await.ok()?;
    let answer = answer.error_for_status().ok()?;
    // an https address redirected to http hasn't answered over https, which the password would then go to in the clear
    if address.starts_with("https:") && answer.url().scheme() != "https" {
        return None;
    }
    let landed = landed_at(answer.url()).unwrap_or(address);
    Some((landed, answer.json().await.ok()?))
}

// Where a probe landed after any redirect: the address its /System/Info/Public sits under, a slash after it or not;
// none when the redirect took it elsewhere.
fn landed_at(url: &Url) -> Option<String> {
    const PROBE: &str = "/System/Info/Public";
    let path = url.path().strip_suffix('/').unwrap_or(url.path());
    let (base, tail) = path.split_at_checked(path.len().checked_sub(PROBE.len())?)?;
    tail.eq_ignore_ascii_case(PROBE).then(|| format!("{}{base}", url.origin().ascii_serialization()))
}

// The addresses a server may answer at, from what was typed. A typed scheme is kept as is. Without one, https comes
// before http, so a sign-in goes encrypted wherever it can, each on the port typed, or else on Emby's (8920, 8096) and
// the scheme's own, where a reverse proxy serves it. The web client's page goes, as its address is the one people copy.
// Every route goes under /emby, which a server answers directly too, and which a reverse proxy may forward and nothing
// else.
fn candidates(typed: &str) -> Option<Vec<String>> {
    let text = typed.trim();
    let lower = text.to_ascii_lowercase();
    let schemed = lower.starts_with("http://") || lower.starts_with("https://");
    let url = Url::parse(&if schemed { text.to_owned() } else { format!("http://{text}") }).ok()?;
    let path = url.path();
    let web = path.match_indices("/web").find(|&(i, _)| matches!(path.as_bytes().get(i + 4), None | Some(b'/')));
    let path = web.map_or(path, |(i, _)| &path[..i]).trim_end_matches('/');
    let path = if path.ends_with("/emby") { path.to_owned() } else { format!("{path}/emby") };
    let at = |scheme: &str, port: Option<u16>| {
        let mut u = url.clone();
        u.set_scheme(scheme).ok()?;
        u.set_port(port).ok()?;
        Some(format!("{}{path}", u.origin().ascii_serialization()))
    };
    if schemed {
        return Some(vec![at(url.scheme(), url.port())?]);
    }
    // read off the host as typed, as the parsed URL drops a typed :80
    let port = text.split(['/', '?', '#']).next()?.rsplit_once(':').and_then(|(_, p)| p.parse().ok());
    Some(match port {
        Some(port) => vec![at("https", Some(port))?, at("http", Some(port))?],
        None => vec![at("https", None)?, at("https", Some(8920))?, at("http", Some(8096))?, at("http", None)?],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_try_https_before_http_on_the_port_typed_or_else_embys_and_the_default() {
        assert_eq!(
            candidates("192.168.1.5").unwrap(),
            [
                "https://192.168.1.5/emby",
                "https://192.168.1.5:8920/emby",
                "http://192.168.1.5:8096/emby",
                "http://192.168.1.5/emby",
            ]
        );
        assert_eq!(candidates(" nas.local:8920 ").unwrap(), ["https://nas.local:8920/emby", "http://nas.local:8920/emby"]);
        assert_eq!(candidates("nas.local:80").unwrap(), ["https://nas.local:80/emby", "http://nas.local/emby"]);
        assert_eq!(candidates("nas.local:9000/#").unwrap(), ["https://nas.local:9000/emby", "http://nas.local:9000/emby"]);
        assert_eq!(candidates("nas.local:9000?x").unwrap(), ["https://nas.local:9000/emby", "http://nas.local:9000/emby"]);
        // a colon further on is no port
        assert_eq!(candidates("nas.local/web/index.html?t=12:30").unwrap().len(), 4);
    }

    #[test]
    fn candidates_keep_a_typed_scheme_port_and_path_under_one_emby() {
        assert_eq!(candidates("https://emby.example.com/").unwrap(), ["https://emby.example.com/emby"]);
        assert_eq!(candidates("HTTPS://Emby.Example.com/emby/").unwrap(), ["https://emby.example.com/emby"]);
        assert_eq!(candidates("http://example.com:8080/media").unwrap(), ["http://example.com:8080/media/emby"]);
    }

    #[test]
    fn candidates_take_the_web_clients_address_as_copied_from_the_browser() {
        assert_eq!(candidates("http://192.168.1.5:8096/web/index.html").unwrap(), ["http://192.168.1.5:8096/emby"]);
        assert_eq!(candidates("https://example.com/emby/web/").unwrap(), ["https://example.com/emby"]);
        assert_eq!(candidates("https://example.com/website").unwrap(), ["https://example.com/website/emby"]);
    }

    #[test]
    fn text_that_is_not_an_address_has_no_candidates() {
        assert_eq!(candidates("not an address"), None);
        assert_eq!(candidates(""), None);
    }

    #[test]
    fn landed_at_keeps_the_address_a_redirect_landed_at_whatever_a_proxy_adds_after_the_path() {
        let at = |url: &str| landed_at(&Url::parse(url).unwrap());
        assert_eq!(at("https://nas.local/emby/System/Info/Public").unwrap(), "https://nas.local/emby");
        assert_eq!(at("https://nas.local/emby/System/Info/Public/").unwrap(), "https://nas.local/emby");
        assert_eq!(at("https://nas.local:8920/emby/system/info/public?x=1").unwrap(), "https://nas.local:8920/emby");
        // taken elsewhere, as to a login page: the address asked is kept
        assert_eq!(at("https://nas.local/login?next=/emby/System/Info/Public/x"), None);
        assert_eq!(at("https://nas.local/login?next=/emby/System/Info/Public"), None);
    }
}
