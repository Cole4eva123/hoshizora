//! 放映室's Emby client. Everything the app asks of an Emby 服务器 goes through [`Emby`]: where the server answers,
//! signing in, keeping the token, and its 媒体库 and 作品, tidied into what the pages draw. It knows nothing of Tauri,
//! so the app's commands are a thin layer over it (src-tauri/src/lib.rs), and its tests run it against a stand-in
//! server (tests/emby.rs).

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::{Client, RequestBuilder, StatusCode};
use serde::de::{DeserializeOwned, IgnoredAny};
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;
use url::Url;

// How long each kind of request may take. https gets 2 s before http is tried, so a password goes in the clear only to
// a server whose https is missing or that slow: a home server's IP mostly turns https down at once, and the wait is for
// a firewall that drops rather than refuses.
const PROBE_HTTPS: Duration = Duration::from_secs(2);
const PROBE_HTTP: Duration = Duration::from_secs(5);
const SIGN_IN: Duration = Duration::from_secs(10);
const CHECK: Duration = Duration::from_secs(5);
const BROWSE: Duration = Duration::from_secs(15);

/// A 服务器 kept on this device, as the pages see it: where it answers, who signed in and when (ms since 1970), and its
/// 备注 if the user gave one. One server signed in as two users is two entries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    pub address: String,
    pub user_id: String,
    pub user_name: String,
    pub signed_in: u64,
}

// A server with the token its sign-in gave, which never leaves this crate. The password is never kept.
#[derive(Clone, Serialize, Deserialize)]
struct Signed {
    #[serde(flatten)]
    server: Server,
    token: String,
}

// What the file keeps: this device's id, which Emby tells its sessions apart by, and the servers.
#[derive(Default, Deserialize)]
struct Kept {
    #[serde(default)]
    device: String,
    #[serde(default)]
    servers: Vec<Signed>,
}

/// Why something asked of a server didn't happen. The pages get it as `{ kind, status? }`.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Error {
    /// What was typed isn't an address.
    NotAnAddress,
    /// Nothing Emby answered: the server is off, or the network is.
    Offline,
    /// The server turned the sign-in down (401, 403): a wrong password, or a disabled user.
    SignIn,
    /// The server turned the kept token down: revoked, or the user is gone.
    SignedOut,
    /// The server answered with another error.
    Server { status: u16 },
    /// No such server is kept here (removed meanwhile).
    NoServer,
    /// What's kept couldn't be written.
    Storage,
}

/// Whether a kept server answers its signed-in user now.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Online,
    Offline,
    SignedOut,
}

/// A 媒体库 of movies or series, with the 16:9 cover the server draws for it.
#[derive(Debug, PartialEq, Serialize)]
pub struct Library {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
}

/// A 作品 as a server keeps it: its name and 海报 there, and the TMDB entry it is, when the server knows it.
#[derive(Debug, PartialEq, Serialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmdb: Option<Tmdb>,
}

/// A TMDB entry, named as the 作品 pages' routes name it.
#[derive(Debug, PartialEq, Serialize)]
pub struct Tmdb {
    pub media_type: &'static str,
    pub id: u64,
}

/// A page of a 媒体库's 作品; the page from the 0th has the count of them all.
#[derive(Debug, PartialEq, Serialize)]
pub struct Page {
    pub items: Vec<Item>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
}

// The parts of Emby's answers read here.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Info {
    id: String,
    server_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Auth {
    access_token: String,
    user: User,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct User {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Listing<T> {
    items: Vec<T>,
    #[serde(default)]
    total_record_count: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct View {
    id: String,
    name: String,
    collection_type: Option<String>,
    #[serde(default)]
    image_tags: Tags,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Listed {
    id: String,
    name: String,
    #[serde(rename = "Type")]
    kind: String,
    production_year: Option<u32>,
    #[serde(default)]
    image_tags: Tags,
    #[serde(default)]
    provider_ids: Ids,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Tags {
    primary: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Ids {
    tmdb: Option<String>,
}

/// Emby as this app reaches it: the servers kept on this device, and everything asked of them. Opened once and
/// shared; its methods can run at the same time.
pub struct Emby {
    // The sign-in and signed-in requests go only where they're sent: a redirect would carry the token in its header,
    // or the password on a 307, to wherever it points. The probes follow redirects, to learn where the server answers.
    http: Client,
    probing: Client,
    file: PathBuf,
    device: String,
    servers: Mutex<Vec<Signed>>,
    // one change written at a time, without holding `servers` through the write, so readers don't wait out a fsync
    writing: Mutex<()>,
}

impl Emby {
    /// The servers kept at `file`, none if it's missing or unreadable; it's written when a server is added or removed.
    /// An unreadable one is moved aside first, to `<name>.unreadable-<ms>.json`, so no later write loses what it held.
    pub fn open(file: PathBuf) -> Emby {
        let kept = match fs::read(&file) {
            Err(e) if e.kind() == ErrorKind::NotFound => Kept::default(),
            read => read.ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_else(|| {
                let _ = fs::rename(&file, file.with_extension(format!("unreadable-{}.json", now())));
                Kept::default()
            }),
        };
        let client = || Client::builder().user_agent(concat!("Hoshizora/", env!("CARGO_PKG_VERSION")));
        Emby {
            http: client().redirect(reqwest::redirect::Policy::none()).build().expect("no TLS backend"),
            probing: client().build().expect("no TLS backend"),
            device: if kept.device.is_empty() { random_id() } else { kept.device },
            servers: Mutex::new(kept.servers),
            writing: Mutex::new(()),
            file,
        }
    }

    /// The kept servers, in the order they were added; never their tokens.
    pub fn servers(&self) -> Vec<Server> {
        self.servers.lock().unwrap().iter().map(|s| s.server.clone()).collect()
    }

    /// Finds where the server typed answers, signs in there and keeps it. The addresses to try come from what was
    /// typed (`candidates`): the https ones are asked at once, and the http ones only once none of those answers. A
    /// redirect, as from a proxy's http to its https, is followed, and the address it lands at is the one kept. Signing
    /// in again as the same user (after 登录已失效) replaces the entry, keeps its 备注 unless a new one is typed, and
    /// ends the old sign-in.
    pub async fn add(&self, typed: &str, username: &str, password: &str, nickname: &str) -> Result<Server, Error> {
        let addresses = candidates(typed).ok_or(Error::NotAnAddress)?;
        let (address, info) = match self.race(&addresses, "https:", PROBE_HTTPS).await {
            Some(found) => found,
            None => self.race(&addresses, "http:", PROBE_HTTP).await.ok_or(Error::Offline)?,
        };
        let answer = self
            .identify(self.http.post(format!("{address}/Users/AuthenticateByName")))
            .json(&serde_json::json!({ "Username": username, "Pw": password }))
            .timeout(SIGN_IN)
            .send()
            .await
            .map_err(|_| Error::Offline)?;
        match answer.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => return Err(Error::SignIn),
            status if !status.is_success() => return Err(Error::Server { status: status.as_u16() }),
            _ => {}
        }
        // a 200 that isn't Emby's answer, as from a proxy's login page, is nothing Emby answered
        let auth: Auth = answer.json().await.map_err(|_| Error::Offline)?;
        let mut signed = Signed {
            server: Server {
                id: info.id,
                name: info.server_name,
                nickname: Some(nickname.trim().to_owned()).filter(|n| !n.is_empty()),
                address,
                user_id: auth.user.id,
                user_name: auth.user.name,
                signed_in: now(),
            },
            token: auth.access_token,
        };
        let old = self.keep(|servers| {
            let old = servers
                .iter()
                .position(|s| s.server.id == signed.server.id && s.server.user_id == signed.server.user_id)
                .map(|i| servers.remove(i));
            signed.server.nickname =
                signed.server.nickname.take().or_else(|| old.as_ref().and_then(|o| o.server.nickname.clone()));
            servers.push(signed.clone());
            old
        });
        let old = match old {
            Ok(old) => old,
            // a sign-in that can't be kept isn't left open on the server either, unless its token is the one Emby handed
            // back, which the kept entry still signs in with
            Err(e) => {
                let still_kept = self.servers.lock().unwrap().iter().any(|s| s.token == signed.token);
                if !still_kept {
                    self.sign_out(signed);
                }
                return Err(e);
            }
        };
        // Emby may hand the same device its token back, which must stay
        if let Some(old) = old.filter(|o| o.token != signed.token) {
            self.sign_out(old);
        }
        Ok(signed.server)
    }

    /// Forgets a kept server, and ends its sign-in on the server in the background. Async though it awaits nothing, as
    /// that sign-out is spawned on the caller's runtime.
    pub async fn remove(&self, server: &str, user: &str) -> Result<(), Error> {
        let gone = self.keep(|servers| {
            let i = servers.iter().position(|s| s.server.id == server && s.server.user_id == user)?;
            Some(servers.remove(i))
        })?;
        if let Some(gone) = gone {
            self.sign_out(gone);
        }
        Ok(())
    }

    /// Whether the server answers its signed-in user now: `SignedOut` when it turns the token down, `Offline` when
    /// nothing answers or no such server is kept.
    pub async fn status(&self, server: &str, user: &str) -> Status {
        let Ok(s) = self.signed(server, user) else { return Status::Offline };
        match self.get::<IgnoredAny>(&s, "System/Info", &[], CHECK).await {
            Ok(_) => Status::Online,
            Err(Error::SignedOut) => Status::SignedOut,
            Err(_) => Status::Offline,
        }
    }

    /// The 媒体库 a server shows its user, in the order set on the server: only those of movies, series or both, as
    /// music, photos and the like can't be played here.
    pub async fn libraries(&self, server: &str, user: &str) -> Result<Vec<Library>, Error> {
        let s = self.signed(server, user)?;
        let views: Listing<View> = self.get(&s, &format!("Users/{}/Views", s.server.user_id), &[], BROWSE).await?;
        Ok(views
            .items
            .into_iter()
            .filter(|v| v.collection_type.as_deref().is_none_or(|t| ["movies", "tvshows", "mixed"].contains(&t)))
            .map(|v| Library { cover: image(&s.server.address, &v.id, v.image_tags.primary, 480), id: v.id, name: v.name })
            .collect())
    }

    /// A page of a 媒体库's movies and series, `limit` of them from the `start`th, the newest added first. Only the page
    /// from the 0th has the count of them all, as counting a large 媒体库 is work for the server.
    pub async fn items(&self, server: &str, user: &str, library: &str, start: u32, limit: u32) -> Result<Page, Error> {
        let s = self.signed(server, user)?;
        let (from, count) = (start.to_string(), limit.to_string());
        let query = [
            ("ParentId", library),
            ("Recursive", "true"),
            ("IncludeItemTypes", "Movie,Series"),
            ("SortBy", "DateCreated,SortName"),
            // an order for each: the newest first, and a batch added at once (a library scan) A to Z
            ("SortOrder", "Descending,Ascending"),
            ("Fields", "ProviderIds,ProductionYear"),
            ("EnableImageTypes", "Primary"),
            ("ImageTypeLimit", "1"),
            ("EnableUserData", "false"),
            ("StartIndex", &from),
            ("Limit", &count),
            ("EnableTotalRecordCount", if start == 0 { "true" } else { "false" }),
        ];
        let listing: Listing<Listed> = self.get(&s, &format!("Users/{}/Items", s.server.user_id), &query, BROWSE).await?;
        Ok(Page {
            items: listing.items.into_iter().map(|i| item(&s.server.address, i)).collect(),
            total: (start == 0).then_some(listing.total_record_count),
        })
    }

    // A kept server with its token, to ask it something.
    fn signed(&self, server: &str, user: &str) -> Result<Signed, Error> {
        let servers = self.servers.lock().unwrap();
        servers.iter().find(|s| s.server.id == server && s.server.user_id == user).cloned().ok_or(Error::NoServer)
    }

    // Asks a kept server for `path`, under its address, as its signed-in user, and reads the answer.
    async fn get<T: DeserializeOwned>(
        &self,
        s: &Signed,
        path: &str,
        query: &[(&str, &str)],
        timeout: Duration,
    ) -> Result<T, Error> {
        let answer = self
            .ask(self.http.get(format!("{}/{path}", s.server.address)), &s.token)
            .query(query)
            .timeout(timeout)
            .send()
            .await
            .map_err(|_| Error::Offline)?;
        match answer.status() {
            StatusCode::UNAUTHORIZED => Err(Error::SignedOut),
            status if !status.is_success() => Err(Error::Server { status: status.as_u16() }),
            _ => answer.json().await.map_err(|_| Error::Offline),
        }
    }

    // Who's asking, in the authorization header every Emby version reads: the app, and this device, whose id is kept
    // across launches.
    fn identify(&self, request: RequestBuilder) -> RequestBuilder {
        let (device, version) = (&self.device, env!("CARGO_PKG_VERSION"));
        let who = format!(r#"Emby Client="Hoshizora", Device="Hoshizora", DeviceId="{device}", Version="{version}""#);
        request.header("X-Emby-Authorization", who)
    }

    // As the signed-in user. The token goes in a header rather than the URL, where a proxy's access log would keep it.
    fn ask(&self, request: RequestBuilder, token: &str) -> RequestBuilder {
        self.identify(request).header("X-Emby-Token", token)
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

    // Ends a sign-in on its server, in the background, so its token stops working there; a server that doesn't answer
    // keeps it until it ends the session itself.
    fn sign_out(&self, s: Signed) {
        let request = self.ask(self.http.post(format!("{}/Sessions/Logout", s.server.address)), &s.token);
        tokio::spawn(async move { request.timeout(BROWSE).send().await.ok() });
    }

    // Changes the kept servers and writes them; the change stands only once written.
    fn keep<T>(&self, change: impl FnOnce(&mut Vec<Signed>) -> T) -> Result<T, Error> {
        let _writing = self.writing.lock().unwrap();
        let mut next = self.servers.lock().unwrap().clone();
        let out = change(&mut next);
        self.write(&next).map_err(|_| Error::Storage)?;
        *self.servers.lock().unwrap() = next;
        Ok(out)
    }

    // Writes this device's id and the servers, readable by this user only, through a temporary file so a crash halfway
    // can't leave half a list.
    // ponytail: the tokens sit in a file only Rust reads, not the Keychain, where every rebuild's new code signature
    // has macOS ask for the login password; move them there once the app is signed with a lasting certificate.
    fn write(&self, servers: &[Signed]) -> std::io::Result<()> {
        let json = serde_json::to_vec_pretty(&serde_json::json!({ "device": self.device, "servers": servers }))?;
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.file.with_extension("tmp");
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut written = options.open(&tmp)?;
        written.write_all(&json)?;
        // on the disk before it takes the list's name, so a power cut can't leave an empty list there
        written.sync_all()?;
        fs::rename(&tmp, &self.file)
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

// A server's picture, sized down to `width`; `tag` changes when one is replaced, so a new one isn't served from the
// cache. Pictures need no token, so the pages load them from the server directly.
// ponytail: an http server's pictures may be blocked in the bundled app (its page is tauri://, and macOS's ATS); hand
// them over through a URI scheme of the app's own if that turns up.
fn image(address: &str, id: &str, tag: Option<String>, width: u32) -> Option<String> {
    tag.map(|tag| format!("{address}/Items/{id}/Images/Primary?tag={tag}&maxWidth={width}&quality=90"))
}

// A 作品 as listed, linked to its TMDB entry when the server knows it.
fn item(address: &str, i: Listed) -> Item {
    let tmdb = i.provider_ids.tmdb.and_then(|id| id.parse::<u64>().ok()).filter(|&id| id > 0);
    Item {
        poster: image(address, &i.id, i.image_tags.primary, 342),
        tmdb: tmdb.map(|id| Tmdb { media_type: if i.kind == "Series" { "tv" } else { "movie" }, id }),
        year: i.production_year,
        id: i.id,
        name: i.name,
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

// This device's id, made on the first launch and kept with the servers.
fn random_id() -> String {
    use std::hash::BuildHasher;
    format!("{:016x}", std::collections::hash_map::RandomState::new().hash_one(SystemTime::now()))
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
