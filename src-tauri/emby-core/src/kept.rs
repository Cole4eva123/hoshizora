//! The 服务器 kept on this device, and this device's id: one file, read when the app opens and written whole on each
//! change.

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;
use std::time::SystemTime;

use serde::Deserialize;

use crate::{Emby, Error, Signed, now};

// What the file keeps: this device's id, which Emby tells its sessions apart by, and the servers.
#[derive(Default, Deserialize)]
pub(crate) struct Kept {
    #[serde(default)]
    pub(crate) device: String,
    #[serde(default)]
    pub(crate) servers: Vec<Signed>,
}

// What `Emby::open` starts from: what's kept at `file`, none if it's missing or unreadable, and this device's id, made
// if there's none yet. An unreadable file is moved aside first, to `<name>.unreadable-<ms>.json`, so no later write
// loses what it held.
pub(crate) fn read(file: &Path) -> Kept {
    let mut kept = match fs::read(file) {
        Err(e) if e.kind() == ErrorKind::NotFound => Kept::default(),
        read => read.ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_else(|| {
            let _ = fs::rename(file, file.with_extension(format!("unreadable-{}.json", now())));
            Kept::default()
        }),
    };
    if kept.device.is_empty() {
        kept.device = random_id();
    }
    kept
}

impl Emby {
    // A kept server with its token, to ask it something.
    pub(crate) fn signed(&self, server: &str, user: &str) -> Result<Signed, Error> {
        let servers = self.servers.lock().unwrap();
        servers.iter().find(|s| s.is(server, user)).cloned().ok_or(Error::NoServer)
    }

    // Changes the kept servers and writes them; the change stands only once written.
    pub(crate) fn keep<T>(&self, change: impl FnOnce(&mut Vec<Signed>) -> T) -> Result<T, Error> {
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

// This device's id, made on the first launch and kept with the servers.
fn random_id() -> String {
    use std::hash::BuildHasher;
    format!("{:016x}", std::collections::hash_map::RandomState::new().hash_one(SystemTime::now()))
}
