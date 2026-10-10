//! Asking a 服务器 as this device and its signed-in user: who's asking, signing in, asking with the token, and
//! signing out.

use std::time::Duration;

use reqwest::header::LOCATION;
use reqwest::{RequestBuilder, Response, StatusCode};
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::find::Info;
use crate::{Emby, Error, Server, Signed, now};

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
        let answer = self
            .ask(self.http.get(format!("{}/{path}", s.server.address)), &s.token)
            .query(query)
            .timeout(timeout)
            .send()
            .await
            .map_err(|_| Error::Offline)?;
        match answer.status() {
            StatusCode::UNAUTHORIZED => Err(Error::SignedOut),
            status if status.is_redirection() && within(&answer) => Err(Error::Moved),
            status if !status.is_success() => Err(Error::Server { status: status.as_u16() }),
            _ => answer.json().await.map_err(|_| Error::Offline),
        }
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
            .map_err(|_| Error::Offline)?;
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
}

// Whether a redirect stays on the host asked, on any port, as when what's in front of the server moves it to https
// (8096 to 443) or another path. One to another host is an error of its own, as a captive portal or an SSO gate sends
// there too, not only a new domain.
fn within(answer: &Response) -> bool {
    let to = answer.headers().get(LOCATION).and_then(|to| to.to_str().ok());
    to.and_then(|to| answer.url().join(to).ok()).is_some_and(|to| to.host() == answer.url().host())
}
