//! Asking a 服务器 as this device and its signed-in user: who's asking, signing in, asking with the token, and
//! signing out.

use std::time::Duration;

use reqwest::header::LOCATION;
use reqwest::{RequestBuilder, Response, StatusCode};
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::find::{Info, unsent};
use crate::{APP, Emby, Error, Server, Signed, VERSION, now};

// a sign-in, which the user waits on as a grey tile: time for the server to start a session for this device, and a
// stuck one turns red rather than staying grey
const SIGN_IN: Duration = Duration::from_secs(10);
// a sign-out goes on in the background, so nobody waits on it
const SIGN_OUT: Duration = Duration::from_secs(15);

// The parts of Emby's answer to a sign-in read here.
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

impl Emby {
    // Asks a kept server for `path`, under its address, as its signed-in user, and reads the answer.
    pub(crate) async fn get<T: DeserializeOwned>(
        &self,
        s: &Signed,
        path: &str,
        query: &[(&str, &str)],
        timeout: Duration,
    ) -> Result<T, Error> {
        let request = self.ask(self.http.get(format!("{}/{path}", s.server.address)), &s.token);
        answer(request.query(query).timeout(timeout)).await
    }

    // As `get`, for what Emby asks to be posted to it, with an empty JSON body.
    pub(crate) async fn post<T: DeserializeOwned>(
        &self,
        s: &Signed,
        path: &str,
        query: &[(&str, &str)],
        timeout: Duration,
    ) -> Result<T, Error> {
        let request = self.ask(self.http.post(format!("{}/{path}", s.server.address)), &s.token);
        answer(request.query(query).json(&serde_json::json!({})).timeout(timeout)).await
    }

    // Signs in as `username` to the server found at `address`; its entry has no 备注 yet.
    pub(crate) async fn sign_in(
        &self,
        address: String,
        info: Info,
        username: &str,
        password: &str,
    ) -> Result<Signed, Error> {
        let answer = self
            .identify(self.http.post(format!("{address}/Users/AuthenticateByName")))
            .json(&serde_json::json!({ "Username": username.trim(), "Pw": password }))
            .timeout(SIGN_IN)
            .send()
            .await
            .map_err(unsent)?;
        match answer.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => return Err(Error::SignIn),
            status if !status.is_success() => return Err(Error::Server { status: status.as_u16() }),
            _ => {}
        }
        // a 200 that isn't Emby's answer, as from a proxy's login page, is nothing Emby answered
        let auth: Auth = answer.json().await.map_err(|_| Error::Offline)?;
        Ok(Signed {
            server: Server {
                id: info.id,
                name: info.server_name,
                nickname: None,
                address,
                user_id: auth.user.id,
                user_name: auth.user.name,
                signed_in: now(),
            },
            token: auth.access_token,
        })
    }

    // Ends a sign-in on its server, in the background, so its token stops working there; a server that doesn't answer
    // keeps it until it ends the session itself.
    pub(crate) fn sign_out(&self, s: Signed) {
        let request = self.ask(self.http.post(format!("{}/Sessions/Logout", s.server.address)), &s.token);
        tokio::spawn(async move { request.timeout(SIGN_OUT).send().await.ok() });
    }

    // A sign-in that can't be kept isn't left open on the server either, unless its token is one a kept entry still
    // signs in with, as Emby may hand a device its token back.
    pub(crate) fn abandon(&self, signed: Signed) {
        let still_kept = self.servers.lock().unwrap().iter().any(|s| s.token == signed.token);
        if !still_kept {
            self.sign_out(signed);
        }
    }

    // Who's asking, in the authorization header every Emby version reads: the app, and this device by its name and its
    // id, which is kept across launches.
    fn identify(&self, request: RequestBuilder) -> RequestBuilder {
        let (name, device) = (&self.name, &self.device);
        let who = format!(r#"Emby Client="{APP}", Device="{name}", DeviceId="{device}", Version="{VERSION}""#);
        request.header("X-Emby-Authorization", who)
    }

    // As the signed-in user. The token goes in a header rather than the URL, where a proxy's access log would keep it.
    fn ask(&self, request: RequestBuilder, token: &str) -> RequestBuilder {
        self.identify(request).header("X-Emby-Token", token)
    }
}

// This Mac's name as its owner set it (Bin 的 MacBook Pro), for a server's 设备 list to tell it from others; the
// app's where there's none.
// ponytail: whether Emby decodes what `header_safe` encodes is unchecked (Jellyfin does); if its 设备 list shows
// %E7…, send `scutil --get LocalHostName` (ASCII already, as Bin-MacBook-Pro) instead.
pub(crate) fn device_name() -> String {
    let named = std::process::Command::new("scutil").args(["--get", "ComputerName"]).output().ok();
    let name = named.filter(|o| o.status.success()).and_then(|o| String::from_utf8(o.stdout).ok());
    // macOS names a Mac with a typographic apostrophe (Bin’s MacBook Pro), which ASCII has its own of
    header_safe(&name.as_deref().map(str::trim).filter(|n| !n.is_empty()).unwrap_or(APP).replace('’', "'"))
}

// A name as the authorization header can carry it: ASCII only, and none of the quote and comma Emby splits its fields
// at, or the % that encodes the rest, as Jellyfin asks of its values.
fn header_safe(name: &str) -> String {
    let keep = |b: u8| b == b' ' || (b.is_ascii_graphic() && !b"\",%".contains(&b));
    name.bytes().map(|b| if keep(b) { char::from(b).to_string() } else { format!("%{b:02X}") }).collect()
}

// Sends a request asked as the signed-in user, and reads what Emby answered: `SignedOut` when it turned the token down,
// `Refused` when it turned the user away, `Moved` for a redirect on its own host, which isn't followed; `Untrusted` when
// its certificate no longer is (expired, say).
async fn answer<T: DeserializeOwned>(request: RequestBuilder) -> Result<T, Error> {
    let answer = request.send().await.map_err(unsent)?;
    match answer.status() {
        StatusCode::UNAUTHORIZED => Err(Error::SignedOut),
        StatusCode::FORBIDDEN => Err(Error::Refused),
        status if status.is_redirection() && within(&answer) => Err(Error::Moved),
        status if !status.is_success() => Err(Error::Server { status: status.as_u16() }),
        _ => answer.json().await.map_err(|_| Error::Offline),
    }
}

// Whether a redirect stays on the host asked, on any port, as when what's in front of the server moves it to https
// (8096 to 443) or another path. One to another host is an error of its own, as a captive portal or an SSO gate sends
// there too, not only a new domain.
fn within(answer: &Response) -> bool {
    let to = answer.headers().get(LOCATION).and_then(|to| to.to_str().ok());
    to.and_then(|to| answer.url().join(to).ok()).is_some_and(|to| to.host() == answer.url().host())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_goes_in_the_header_as_ascii_with_its_quotes_and_commas_encoded() {
        assert_eq!(header_safe("Bin 的 MacBook Pro"), "Bin %E7%9A%84 MacBook Pro");
        assert_eq!(header_safe(r#"a"b,c%d"#), "a%22b%2Cc%25d");
    }
}
