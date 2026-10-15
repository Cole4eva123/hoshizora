//! 放映室's Emby client. Everything the app asks of an Emby 服务器 goes through [`Emby`]: where the server answers,
//! signing in, keeping the token, and its 媒体库 and 作品, tidied into what the pages draw. It knows nothing of Tauri,
//! so the app's commands are a thin layer over it (src-tauri/src/lib.rs), and its tests run it against a stand-in
//! server (tests/emby.rs).
//!
//! Behind it, each module is where one kind of change lands: `find`, where a server answers; `session`, asking as this
//! device and its signed-in user; `kept`, the servers kept on this device; `browse`, the 媒体库 and 作品; `sources`,
//! where a 作品 can be played, its 片源 and their versions and tracks, and what a version plays (its link, and where
//! the user left off); `watching`, the user's place in what they play, the 继续观看 and telling the server. This file
//! ties them together: adding a server, changing it, removing it, and how it answers now.

mod browse;
mod find;
mod kept;
mod relay;
mod session;
mod sources;
mod watching;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};

pub use browse::{Item, Library, Page, Sort, Tmdb};
pub use sources::{Episode, Play, Source, Track, Version, Video};
pub use watching::{Resume, Watch};
use find::Info;

// How long a request asked of a kept server may take: whether it answers now, and the 媒体库 and 作品. Finding a
// server, signing in and signing out keep their own, in `find` and `session`.
const CHECK: Duration = Duration::from_secs(5);
// an edit's look at whether a kept sign-in still works, short as one that doesn't answer is kept anyway
const RECHECK: Duration = Duration::from_secs(2);
// a 媒体库's page or a 作品's lookup, which a large 媒体库 on a NAS's disks may take seconds over; past it, the page
// offers 重试
const BROWSE: Duration = Duration::from_secs(15);
// how long a kept server may take to take a connection, for what's asked with no time limit of its own: a film played
// through the server (relay.rs), whose seek while the server's gone then fails rather than waiting out the system's
const CONNECT: Duration = Duration::from_secs(10);

// The app as a server's logs and 设备 list name it, and its version, which the workspace gives this crate and the app
// alike (src-tauri/Cargo.toml).
const APP: &str = "Hoshizora";
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The app as it names itself to what it asks over the network (Hoshizora/0.1.0): servers, and the player, which asks
/// for a version's link with it too.
pub fn user_agent() -> String {
    format!("{APP}/{VERSION}")
}

/// A kind of 作品, as TMDB and the pages' routes name it (`movie`, `tv`), so the pages' `mediaTypes` and this agree
/// on the wire. A kind added here (and to `ALL`) is listed in the 媒体库 and found by its TMDB entry; each `match`
/// below asks for what Emby calls it. One the pages send that isn't here fails at the command, not as a movie.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Movie,
    Tv,
}

impl Kind {
    const ALL: [Kind; 2] = [Kind::Movie, Kind::Tv];
    /// Emby's type for a 媒体库 of several kinds, listed with those of each
    const MIXED: &str = "mixed";

    /// Emby's item type for it
    fn item_type(self) -> &'static str {
        match self {
            Kind::Movie => "Movie",
            Kind::Tv => "Series",
        }
    }

    /// Emby's type for a 媒体库 of it
    fn collection(self) -> &'static str {
        match self {
            Kind::Movie => "movies",
            Kind::Tv => "tvshows",
        }
    }

    /// Emby's item type for what of it plays, which has the user's place in it: a movie, or an episode of a series
    fn plays(self) -> &'static str {
        match self {
            Kind::Movie => "Movie",
            Kind::Tv => "Episode",
        }
    }

    /// whether it plays by the episode: its 片源 has seasons, and its versions are its episodes'; the pages' `mediaTypes`
    /// say the same of it, and draw its 片源 and 选集 by that
    fn episodic(self) -> bool {
        match self {
            Kind::Movie => false,
            Kind::Tv => true,
        }
    }
}

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

/// What the dialog that adds a server, or changes one, sends: the address as typed, the user to sign in as, the
/// password (empty when there's none, or when a change keeps the sign-in), and the 备注 (empty for none). No `Debug`,
/// so the password can't end up in a log.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Form {
    pub address: String,
    pub username: String,
    pub password: String,
    pub nickname: String,
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

/// Why something asked of a server didn't happen. The pages get it as `{ kind, status? }`, and name each kind
/// (`EmbyError` in src/lib/emby.ts, which a kind added here goes into).
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Error {
    /// What was typed isn't an address.
    NotAnAddress,
    /// Nothing Emby answered: the server is off, or the network is.
    Offline,
    /// The address answers over https with a certificate this Mac doesn't trust (self-signed, expired, another
    /// name's). Nothing more is asked of it, over http neither, where the password would go in the clear.
    Untrusted,
    /// The server turned the sign-in down (401, 403): a wrong password, or a disabled user.
    SignIn,
    /// The server turned the kept token down: revoked, or the user is gone.
    SignedOut,
    /// The address answers with a redirect on its own host, not followed as the token would go along: what's in front
    /// of the server moved it, to https or another path. A new address in its settings is the way back.
    Moved,
    /// The server, or what's in front of it, turned the signed-in user away (403): the account disabled, or barred from
    /// where the app is or at this hour, or a proxy's rule.
    Refused,
    /// The server answered with another error.
    Server { status: u16 },
    /// The version plays only converted by the server (transcoded or remuxed), which the app doesn't ask for.
    Unplayable,
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
    Moved,
    Refused,
    Untrusted,
}

/// Emby as this app reaches it: the servers kept on this device, and everything asked of them. Opened once and
/// shared; its methods can run at the same time.
pub struct Emby {
    // The sign-in and signed-in requests go only where they're sent: a redirect would carry the token in its header,
    // or the password on a 307, to wherever it points. The probes follow redirects, to learn where the server answers.
    http: Client,
    probing: Client,
    // where the servers are written; none when the file there couldn't be read, which stays as it is till next launch
    file: Option<PathBuf>,
    device: String,
    // this Mac's name, as a header carries it (`session::device_name`)
    name: String,
    // shared with a write, which the list takes the change from (`keep`)
    servers: Arc<Mutex<Vec<Signed>>>,
    // One change written at a time, without holding `servers` through the write, so readers don't wait out a fsync.
    // Waited for without holding a thread, as the write it waits out is a fsync too; held by the write till it's done.
    writing: Arc<tokio::sync::Mutex<()>>,
    // where mpv asks for what plays through the server, started the first time something does
    relay: tokio::sync::OnceCell<relay::Relay>,
}

impl Emby {
    /// The servers kept at `file` (`kept::read`), written on each change to them; none, and no change, when the file
    /// is there but can't be read now.
    pub fn open(file: PathBuf) -> Emby {
        let (kept, file) = kept::read(file);
        let client = || Client::builder().user_agent(user_agent());
        Emby {
            http: client().redirect(reqwest::redirect::Policy::none()).connect_timeout(CONNECT).build().expect("no TLS backend"),
            probing: client().build().expect("no TLS backend"),
            device: kept.device,
            name: session::device_name(),
            servers: Arc::new(Mutex::new(kept.servers)),
            writing: Arc::default(),
            relay: tokio::sync::OnceCell::new(),
            file,
        }
    }

    /// The kept servers, in the order they were added; never their tokens.
    pub fn servers(&self) -> Vec<Server> {
        self.servers.lock().unwrap().iter().map(|s| s.server.clone()).collect()
    }

    /// Finds where the server typed answers (`find`), signs in there and keeps it. Signing in again as the same user
    /// (after 登录已失效) replaces the entry, keeps its 备注 unless a new one is typed, and ends the old sign-in.
    pub async fn add(&self, form: &Form) -> Result<Server, Error> {
        // nothing can be kept this launch (`kept::read`), so nothing is asked of the server either
        self.file.as_ref().ok_or(Error::Storage)?;
        let (address, info) = self.find(&form.address).await?;
        let mut signed = self.sign_in(address, info, &form.username, &form.password).await?;
        signed.server.nickname = nickname_of(&form.nickname);
        let old = self.keep(|servers| {
            let old =
                servers.iter().position(|s| s.is(&signed.server.id, &signed.server.user_id)).map(|i| servers.remove(i));
            signed.server.nickname =
                signed.server.nickname.take().or_else(|| old.as_ref().and_then(|o| o.server.nickname.clone()));
            servers.push(signed.clone());
            old
        })
        .await;
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
    pub async fn edit(&self, server: &str, user: &str, form: &Form) -> Result<Server, Error> {
        let Form { address: typed, username, password, nickname } = form;
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
            && !matches!(self.check(&moved, RECHECK).await, Err(Error::SignedOut));
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
        })
        .await;
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

    /// Forgets a kept server, and ends its sign-in on the server in the background, spawned on the caller's runtime.
    pub async fn remove(&self, server: &str, user: &str) -> Result<(), Error> {
        let gone = self.keep(|servers| {
            let i = servers.iter().position(|s| s.is(server, user))?;
            Some(servers.remove(i))
        })
        .await?;
        if let Some(gone) = gone {
            self.sign_out(gone);
        }
        Ok(())
    }

    /// Whether the server answers its signed-in user now: `SignedOut` when it turns the token down, `Moved` when its
    /// address redirects, `Refused` when it turns the user away, `Untrusted` when its certificate no longer is, `Offline`
    /// when nothing answers or no such server is kept.
    pub async fn status(&self, server: &str, user: &str) -> Status {
        let Ok(s) = self.signed(server, user) else { return Status::Offline };
        match self.check(&s, CHECK).await {
            Ok(_) => Status::Online,
            Err(Error::SignedOut) => Status::SignedOut,
            Err(Error::Moved) => Status::Moved,
            Err(Error::Refused) => Status::Refused,
            Err(Error::Untrusted) => Status::Untrusted,
            Err(_) => Status::Offline,
        }
    }

    // Whether a kept sign-in works there now: a signed-in ask for the server's own info, which any user may read.
    async fn check(&self, s: &Signed, timeout: Duration) -> Result<IgnoredAny, Error> {
        self.get(s, "System/Info", &[], timeout).await
    }
}

// A 备注 as typed: none when left empty.
fn nickname_of(typed: &str) -> Option<String> {
    Some(typed.trim().to_owned()).filter(|n| !n.is_empty())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}
