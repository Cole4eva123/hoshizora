//! Telling the 服务器 how playing goes (emby-core's `watch`, `progress` and `stopped`, M5), so its 继续观看 and where a
//! 作品 picks up follow what was watched here: what the player hears is sent, in order, to a thread of its own that
//! asks the server, so mpv's events never wait on the network, and a stop never lands before the start it ends.
//!
//! ponytail: a stop not yet told when the app quits (⌘Q) is lost, as its thread goes with the app; the server keeps
//! the last progress told, at most 10 s behind. Tell the stop on RunEvent::ExitRequested, waiting for it, if that's
//! too little.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Sender, channel};

use emby_core::{Emby, Error, Watch};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

// what the main window (as its capability names it, capabilities/default.json) hears once a server has taken a stop,
// that server's 继续观看 changed (src/lib/emby.ts)
const MAIN: &str = "main";
const RESUMED: &str = "emby://resume";
// how far into the film playing goes, in seconds, before the server is told where it is again, as Emby's own apps do
const EVERY: i64 = 10;
// how many times a playing's start is told before it's given up, each a read of its file on the server
const TRIES: u32 = 3;

/// What's played, as the server knows it: a version of a 作品 there, as the user signed in.
#[derive(Clone, Serialize)]
pub struct Origin {
    pub server: String,
    pub user: String,
    pub item: String,
    pub version: String,
}

/// What's told of playing, each of the version numbered as it started (`numbered`), at so many seconds in: that it
/// started (once it plays), where it is and whether it's paused, and that it stopped (another opening, or the window
/// closing).
pub enum Told {
    Started(u64, Origin, f64),
    Progress(u64, f64, bool),
    Stopped(u64, f64),
}

/// A number for a version that starts playing, the app's first 0, so what's told of it is told of it and no other: one
/// window closed while another starts may tell its last after that start.
pub fn numbered() -> u64 {
    static PLAYED: AtomicU64 = AtomicU64::new(0);
    PLAYED.fetch_add(1, Ordering::Relaxed)
}

/// Whether where playing is now (`at` seconds in, and whether `paused`) is to be told, as last told `told`: paused or
/// playing at once, else every EVERY seconds of the film, a seek as far too.
pub fn due(told: Option<(i64, bool)>, at: i64, paused: bool) -> bool {
    told.is_none_or(|(then, was)| was != paused || (at - then).abs() >= EVERY)
}

// Whether the `i`th of the reports waiting says nothing those after it don't, as when the server was slow to answer: a
// progress with more after it, unless it's a pause or a play the next progress doesn't tell.
fn said(waiting: &[Told], i: usize) -> bool {
    match (&waiting[i], waiting.get(i + 1)) {
        (Told::Progress(_, _, was), Some(Told::Progress(_, _, then))) => was == then,
        (Told::Progress(..), Some(_)) => true,
        _ => false,
    }
}

/// The thread telling the server, for as long as the app runs. A report the server couldn't take is left at that, as the
/// next tells where it is; a start nothing answered (its file slow to read, the network down) is told again before the
/// next report, so the rest of that playing still counts (TRIES times at most, as each has the server read the file), but
/// not one turned down for good (refused, signed out, the 作品 gone, its address or certificate no longer good), which
/// asking again won't change.
pub fn reporter(app: &AppHandle) -> Result<Sender<Told>, String> {
    let (tell, heard) = channel::<Told>();
    let app = app.clone();
    std::thread::Builder::new()
        .name("player reports".into())
        .spawn(move || {
            let emby = app.state::<Emby>();
            // what plays, by its number, till it's stopped, its play session once the server has taken its start, how
            // many times that's been told, and where it was last told to be
            let (mut playing, mut watch, mut tries, mut told) = (None::<(u64, Origin)>, None::<Watch>, 0, 0.0);
            while let Ok(first) = heard.recv() {
                let waiting: Vec<_> = std::iter::once(first).chain(heard.try_iter()).collect();
                let skipped: Vec<_> = (0..waiting.len()).map(|i| said(&waiting, i)).collect();
                for (report, skip) in waiting.into_iter().zip(skipped) {
                    if skip {
                        continue;
                    }
                    let done: Result<(), Error> = tauri::async_runtime::block_on(async {
                        let (n, at) = match &report {
                            Told::Started(n, o, at) => {
                                // one still open, its stop to come after this start (a window closed as another
                                // opened), stopped where it was last told to be, as that stop will be dropped
                                if let (Some(w), Some((_, open))) = (watch.take(), playing.take()) {
                                    let _ = emby.stopped(&w, told).await;
                                    let _ = app.emit_to(MAIN, RESUMED, open);
                                }
                                (playing, tries) = (Some((*n, o.clone())), 0);
                                (*n, *at)
                            }
                            Told::Progress(n, at, _) | Told::Stopped(n, at) => (*n, *at),
                        };
                        // what's told of one that no longer plays here tells nothing of what does
                        if playing.as_ref().is_none_or(|(m, _)| *m != n) {
                            return Ok(());
                        }
                        if watch.is_none() && let Some((_, o)) = &playing {
                            match emby.watch(&o.server, &o.user, &o.item, &o.version, at).await {
                                Ok(w) => watch = Some(w),
                                Err(e) => {
                                    tries += 1;
                                    let lasting = matches!(
                                        e,
                                        Error::SignedOut | Error::Refused | Error::Moved | Error::Untrusted | Error::NoServer
                                    );
                                    if lasting || e == (Error::Server { status: 404 }) || tries == TRIES {
                                        playing = None;
                                    }
                                    return Err(e);
                                }
                            }
                        }
                        told = at;
                        match report {
                            Told::Progress(_, at, paused) => {
                                if let Some(w) = &mut watch {
                                    emby.progress(w, at, paused).await?;
                                }
                            }
                            // nothing plays from here, told or not
                            Told::Stopped(_, at) => {
                                if let (Some(w), Some((_, o))) = (watch.take(), playing.take()) {
                                    let stopped = emby.stopped(&w, at).await;
                                    // the progress told meanwhile has changed the 继续观看, whether the stop is taken or not
                                    let _ = app.emit_to(MAIN, RESUMED, o);
                                    stopped?;
                                }
                            }
                            Told::Started(..) => {}
                        }
                        Ok(())
                    });
                    if let Err(e) = done {
                        eprintln!("player: telling the server: {e:?}");
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(tell)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playing_is_told_every_ten_seconds_of_the_film_and_at_once_when_paused_or_played() {
        assert!(due(None, 5, false));
        assert!(!due(Some((100, false)), 109, false));
        assert!(due(Some((100, false)), 110, false));
        // a seek as far, back or on
        assert!(due(Some((100, false)), 40, false));
        assert!(due(Some((100, false)), 101, true));
        assert!(due(Some((100, true)), 100, false));
        // still paused, where it was
        assert!(!due(Some((100, true)), 100, true));
    }

    #[test]
    fn a_progress_with_more_waiting_after_it_is_dropped_but_not_a_pause_the_next_one_does_not_tell() {
        let progress = |paused| Told::Progress(1, 0.0, paused);
        let waiting = [progress(false), progress(false), progress(true), progress(false), Told::Stopped(1, 0.0)];
        let said: Vec<_> = (0..waiting.len()).map(|i| said(&waiting, i)).collect();
        assert_eq!(said, [true, false, false, true, false]);
    }
}
