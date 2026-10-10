//! 放映室's Emby client. Everything the app asks of an Emby 服务器 goes through [`Emby`]: where the server answers,
//! signing in, keeping the token, and its 媒体库 and 作品, tidied into what the pages draw. It knows nothing of Tauri,
//! so the app's commands are a thin layer over it (src-tauri/src/lib.rs), and its tests run it against a stand-in
//! server (tests/emby.rs).
//!
//! Behind it, each module is where one kind of change lands: `find`, where a server answers; `session`, asking as this
//! device and its signed-in user; `kept`, the servers kept on this device; `browse`, the 媒体库 and 作品. This file ties
//! them together: adding a server, changing it, removing it, and how it answers now.

mod browse;
mod find;
mod kept;
mod session;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};

pub use browse::{Item, Library, Page, Sort, Tmdb};
use find::Info;

// How long a request asked of a kept server may take: whether it answers now, and the 媒体库 and 作品. Finding a
// server, signing in and signing out keep their own, in `find` and `session`.
const CHECK: Duration = Duration::from_secs(5);
// an edit's look at whether a kept sign-in still works, short as one that doesn't answer is kept anyway
const RECHECK: Duration = Duration::from_secs(2);
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

impl Signed {
    // Whether this is the entry for `server` signed in as `user`, a pair no two kept entries share.
    fn is(&self, server: &str, user: &str) -> bool {
        self.server.id == server && self.server.user_id == user
    }
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
    /// The servers kept at `file` (`kept::read`), written on each change to them.
    pub fn open(file: PathBuf) -> Emby {
        let kept = kept::read(&file);
        let client = || Client::builder().user_agent(concat!("Hoshizora/", env!("CARGO_PKG_VERSION")));
        Emby {
            http: client().redirect(reqwest::redirect::Policy::none()).build().expect("no TLS backend"),
            probing: client().build().expect("no TLS backend"),
            device: kept.device,
            servers: Mutex::new(kept.servers),
            writing: Mutex::new(()),
            file,
        }
    }

    /// The kept servers, in the order they were added; never their tokens.
    pub fn servers(&self) -> Vec<Server> {
        self.servers.lock().unwrap().iter().map(|s| s.server.clone()).collect()
    }

    /// Finds where the server typed answers (`find`), signs in there and keeps it. Signing in again as the same user
    /// (after 登录已失效) replaces the entry, keeps its 备注 unless a new one is typed, and ends the old sign-in.
    pub async fn add(&self, typed: &str, username: &str, password: &str, nickname: &str) -> Result<Server, Error> {
        let (address, info) = self.find(typed).await?;
        let mut signed = self.sign_in(address, info, username, password).await?;
        signed.server.nickname = nickname_of(nickname);
        let old = self.keep(|servers| {
            let old =
                servers.iter().position(|s| s.is(&signed.server.id, &signed.server.user_id)).map(|i| servers.remove(i));
            signed.server.nickname =
                signed.server.nickname.take().or_else(|| old.as_ref().and_then(|o| o.server.nickname.clone()));
            servers.push(signed.clone());
            old
        });
        let old = match old {
            Ok(old) => old,
            Err(e) => {
                self.abandon(signed);
                return Err(e);
            }
        };
        // Emby may hand the same device its token back, which must stay
        if let Some(old) = old.filter(|o| o.token != signed.token) {
            self.sign_out(old);
        }
        Ok(signed.server)
    }

    /// Changes a kept server as its settings say: where it's reached (typed as for `add`), who's signed in, and its 备注
    /// (left empty, none). The sign-in is kept for the same user with no password typed, while the server still takes
    /// it; at a new address, only where a server with the same id answers, and never from https to http, where its
    /// token would go in the clear. Otherwise it signs in again and ends the old sign-in, which also renews one the
    /// server turned down, as for a user with no password to type. All of it holds or none of it does, and the entry
    /// keeps its place in the list.
    pub async fn edit(
        &self,
        server: &str,
        user: &str,
        typed: &str,
        username: &str,
        password: &str,
        nickname: &str,
    ) -> Result<Server, Error> {
        let kept = self.signed(server, user)?;
        // where it's reached, and who answers there: asked only of an address that's new
        let (address, info) = if typed.trim() == kept.server.address {
            (kept.server.address.clone(), Info { id: kept.server.id.clone(), server_name: kept.server.name.clone() })
        } else {
            self.find(typed).await?
        };
        let moved = Signed {
            server: Server { address: address.clone(), name: info.server_name.clone(), ..kept.server.clone() },
            token: kept.token.clone(),
        };
        // The token goes out, to see that it still works, only once the rest holds.
        // ponytail: the id is public, so a host that copies it gets the token: over https only the host typed (or
        // redirected to), as its certificate shows; over http any, though there the token went in the clear already.
        // Ask for the password whenever the host changes if that's too little.
        let keeps = info.id == kept.server.id
            && password.is_empty()
            // the same user, whatever the case of the name, as Emby has it
            && username.trim().to_lowercase() == kept.server.user_name.to_lowercase()
            && (address.starts_with("https:") || !kept.server.address.starts_with("https:"))
            && !matches!(self.get::<IgnoredAny>(&moved, "System/Info", &[], RECHECK).await, Err(Error::SignedOut));
        let mut next = if keeps { moved } else { self.sign_in(address, info, username, password).await? };
        next.server.nickname = nickname_of(nickname);
        let replaced = self.keep(|servers| {
            let i = servers.iter().position(|s| s.is(server, user))?;
            // the sign-in kept is the one there now, which an add may have renewed meanwhile
            if keeps {
                next.token = servers[i].token.clone();
                next.server.signed_in = servers[i].server.signed_in;
            }
            let edited = std::mem::replace(&mut servers[i], next.clone());
            // one kept already as the server and user it now is goes, as this one stands for it
            let twin = servers.iter().enumerate().position(|(j, s)| j != i && s.is(&next.server.id, &next.server.user_id));
            Some([Some(edited), twin.map(|j| servers.remove(j))])
        });
        match replaced.and_then(|replaced| replaced.ok_or(Error::NoServer)) {
            Ok(replaced) => {
                for old in replaced.into_iter().flatten().filter(|o| o.token != next.token) {
                    self.sign_out(old);
                }
                Ok(next.server)
            }
            Err(e) => {
                self.abandon(next);
                Err(e)
            }
        }
    }

    /// Forgets a kept server, and ends its sign-in on the server in the background. Async though it awaits nothing, as
    /// that sign-out is spawned on the caller's runtime.
    pub async fn remove(&self, server: &str, user: &str) -> Result<(), Error> {
        let gone = self.keep(|servers| {
            let i = servers.iter().position(|s| s.is(server, user))?;
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
}

// A 备注 as typed: none when left empty.
fn nickname_of(typed: &str) -> Option<String> {
    Some(typed.trim().to_owned()).filter(|n| !n.is_empty())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}
