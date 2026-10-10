//! The 服务器 kept on this device, and this device's id: one file, read when the app opens and written whole on each
//! change.

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
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

// What `Emby::open` starts from: what's kept at `file`, this device's id (made if there's none yet), and where changes
// are written. A file that isn't what's kept is moved aside first, to `<name>.unreadable-<ms>.json`, so no later write
// loses what it held. One that can't be read now (no permission, a disk error) may read on the next launch, so it stays
// where it is, as does one that can't be moved aside, and nothing is written this launch. Either way none are kept.
// ponytail: the pages only hear 没能保存 when they try to keep one; name the file and why if it ever turns up.
pub(crate) fn read(file: PathBuf) -> (Kept, Option<PathBuf>) {
    let (mut kept, file) = match fs::read(&file) {
        Err(e) if e.kind() == ErrorKind::NotFound => (Kept::default(), Some(file)),
        Err(_) => (Kept::default(), None),
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(kept) => (kept, Some(file)),
            Err(_) => {
                let aside = fs::rename(&file, file.with_extension(format!("unreadable-{}.json", now())));
                (Kept::default(), aside.is_ok().then_some(file))
            }
        },
    };
    if kept.device.is_empty() {
        kept.device = random_id();
    }
    (kept, file)
}

impl Emby {
    // A kept server with its token, to ask it something.
    pub(crate) fn signed(&self, server: &str, user: &str) -> Result<Signed, Error> {
        let servers = self.servers.lock().unwrap();
        servers.iter().find(|s| s.is(server, user)).cloned().ok_or(Error::NoServer)
    }

    // Changes the kept servers and writes them; the change stands only once written. The write waits on the disk, so
    // it runs on tokio's threads for blocking work, leaving free the ones that answer the pages. The list takes the
    // change there too, before the lock goes: the next change starts from this one, and one whose caller stopped
    // waiting lands whole, in the file and the list both.
    pub(crate) async fn keep<T>(&self, change: impl FnOnce(&mut Vec<Signed>) -> T) -> Result<T, Error> {
        let file = self.file.clone().ok_or(Error::Storage)?;
        let writing = self.writing.clone().lock_owned().await;
        let mut next = self.servers.lock().unwrap().clone();
        let out = change(&mut next);
        let json = serde_json::to_vec_pretty(&serde_json::json!({ "device": self.device, "servers": next }))
            .map_err(|_| Error::Storage)?;
        let servers = self.servers.clone();
        let written = tokio::task::spawn_blocking(move || {
            let _writing = writing;
            write(&file, &json).map(|()| *servers.lock().unwrap() = next)
        });
        written.await.ok().and_then(Result::ok).ok_or(Error::Storage)?;
        Ok(out)
    }
}

// Writes what's kept, readable by this user only, through a temporary file so a crash halfway can't leave half a list.
// ponytail: the tokens sit in a file only Rust reads, not the Keychain, where every rebuild's new code signature has
// macOS ask for the login password; move them there once the app is signed with a lasting certificate.
fn write(file: &Path, json: &[u8]) -> std::io::Result<()> {
    let dir = file.parent().unwrap_or(Path::new(""));
    fs::create_dir_all(dir)?;
    let tmp = file.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut written = options.open(&tmp)?;
    written.write_all(json)?;
    // on the disk before it takes the list's name, so a power cut can't leave an empty list there
    written.sync_all()?;
    fs::rename(&tmp, file)?;
    // and the new name on the disk, which a power cut could otherwise undo. Not an error if it fails: the list has its
    // name by now, and the next launch reads it, so failing the change would only tell the pages it didn't happen.
    let _ = fs::File::open(dir).and_then(|d| d.sync_all());
    Ok(())
}

// This device's id, made on the first launch and kept with the servers.
fn random_id() -> String {
    use std::hash::BuildHasher;
    format!("{:016x}", std::collections::hash_map::RandomState::new().hash_one(SystemTime::now()))
}
