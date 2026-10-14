//! The player (docs/playback-plan.md): a window of its own where mpv plays a version from its own link, the picture
//! drawn under the page (player.html), whose controls float over it. player_open (src/lib.rs) opens the window, or
//! plays the next version in it; the page tells it what to do (`Command`), and hears how playing goes (`State`).

mod layer;
mod mpv;

use std::ffi::c_int;
use std::sync::{Arc, Mutex};

use emby_core::Play;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSWindow, NSWindowStyleMask};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use serde::{Deserialize, Serialize};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, Theme, TitleBarStyle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri::WindowEvent;

use layer::Picture;
use mpv::{Event, Mpv};

// the player's window, as its capability names it (capabilities/player.json)
const LABEL: &str = "player";
// what the page hears, whenever playing changes
const STATE: &str = "player://state";

// What the event thread hears of mpv: whether it's paused, where it's at and how long it is, whether it waits on the
// network or a seek, whether it's at the end, and the picture's size (as shown, its aspect applied), which comes some
// time after mpv says the picture changed. One added here is asked for by `property`, and handled in `listen`.
#[derive(Clone, Copy, PartialEq)]
enum Watched {
    Pause,
    Position,
    Duration,
    Stalled,
    Seeking,
    Ended,
    Width,
    Height,
}

impl Watched {
    const ALL: [Watched; 8] = [
        Watched::Pause,
        Watched::Position,
        Watched::Duration,
        Watched::Stalled,
        Watched::Seeking,
        Watched::Ended,
        Watched::Width,
        Watched::Height,
    ];

    // mpv's name for it, and what it's heard as
    fn property(self) -> (&'static str, c_int) {
        match self {
            Watched::Pause => ("pause", mpv::FLAG),
            // in whole seconds, so a change a second at most
            Watched::Position => ("time-pos", mpv::INT64),
            Watched::Duration => ("duration", mpv::DOUBLE),
            Watched::Stalled => ("paused-for-cache", mpv::FLAG),
            Watched::Seeking => ("seeking", mpv::FLAG),
            Watched::Ended => ("eof-reached", mpv::FLAG),
            Watched::Width => ("dwidth", mpv::INT64),
            Watched::Height => ("dheight", mpv::INT64),
        }
    }
}

// the least the window may be, in points
const LEAST: (f64, f64) = (480.0, 270.0);

/// How playing goes, as the page draws it: sent whole on each change, and asked for as the page opens (player_state).
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    /// the 作品, as the page that opened the player names it
    title: String,
    /// where it's at and how long it is, in seconds; none till the file says
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<f64>,
    paused: bool,
    /// opening the file, seeking, or the network behind
    waiting: bool,
    /// stopped on the last frame, at the end
    ended: bool,
    /// why it couldn't be opened or played on, in mpv's words
    #[serde(skip_serializing_if = "Option::is_none")]
    failed: Option<String>,
}

/// What the page asks of the player.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Command {
    Pause { paused: bool },
}

/// The player, as the app keeps it: nothing while its window is closed.
#[derive(Default)]
pub struct Player(Mutex<Option<Playing>>);

struct Playing {
    // an Option, to go first: libmpv asks for the renderer to go before the core
    picture: Option<Picture>,
    mpv: Arc<Mpv>,
    state: Arc<Mutex<State>>,
}

impl Playing {
    // Starts playing in `window`: mpv, the picture it draws into, and the thread hearing it.
    fn new(app: &AppHandle, mtm: MainThreadMarker, window: &WebviewWindow) -> Result<Playing, String> {
        let ns_window = unsafe { &*(window.ns_window().map_err(|e| e.to_string())? as *const NSWindow) };
        // mpv drawing into the picture, decoding on the GPU where it can, stopped on the last frame at the end, waiting
        // when there's nothing to play. Over the network it asks as the app's Emby side does (its User-Agent), with no
        // headers of the server's (the token never goes along), certificates checked, which mpv skips with FFmpeg
        // before 63 unless told, and a link played as it is, never handed to youtube-dl.
        let agent = emby_core::user_agent();
        let mpv = Arc::new(Mpv::new(&[
            ("vo", "libmpv"),
            ("hwdec", "auto-safe"),
            ("keep-open", "yes"),
            ("idle", "yes"),
            ("user-agent", &agent),
            ("tls-verify", "yes"),
            ("ytdl", "no"),
        ])?);
        for watched in Watched::ALL {
            let (name, format) = watched.property();
            mpv.observe(watched as u64, name, format)?;
        }
        // before anything plays, as mpv's video output needs the renderer
        let picture = Picture::new(mtm, ns_window, &mpv)?;
        let state = Arc::new(Mutex::new(State::default()));
        std::thread::Builder::new()
            .name("mpv events".into())
            .spawn({
                let (app, mpv, state) = (app.clone(), mpv.clone(), state.clone());
                move || listen(&app, &mpv, &state)
            })
            .map_err(|e| e.to_string())?;
        Ok(Playing { picture: Some(picture), mpv, state })
    }
}

impl Drop for Playing {
    fn drop(&mut self) {
        drop(self.picture.take());
        // the core quits; it goes with the event thread's handle, the last, once that thread hears it
        let _ = self.mpv.command(&["quit"]);
    }
}

impl Player {
    pub fn state(&self) -> State {
        let playing = self.0.lock().unwrap();
        playing.as_ref().map(|p| p.state.lock().unwrap().clone()).unwrap_or_default()
    }

    pub fn command(&self, command: Command) {
        let playing = self.0.lock().unwrap();
        let Some(p) = playing.as_ref() else { return };
        let done = match command {
            Command::Pause { paused } => p.mpv.set_flag("pause", paused),
        };
        if let Err(e) = done {
            eprintln!("player: {e}");
        }
    }
}

/// Plays `play` in the player's window, opening it if it's closed, from where the user left off.
pub async fn open(app: &AppHandle, play: Play, title: String) -> Result<(), String> {
    // on the main thread, where windows and their views are made
    let (done, mut answer) = tauri::async_runtime::channel(1);
    let on_main = app.clone();
    app.run_on_main_thread(move || {
        let _ = done.try_send(open_here(&on_main, &play, title));
    })
    .map_err(|e| e.to_string())?;
    answer.recv().await.unwrap_or_else(|| Err("the main thread didn't answer".into()))
}

fn open_here(app: &AppHandle, play: &Play, title: String) -> Result<(), String> {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => create(app, &title)?,
    };
    {
        let playing = app.state::<Player>();
        let playing = playing.0.lock().unwrap();
        let p = playing.as_ref().ok_or("the player has closed")?;
        // what's playing now, before mpv tells of it (or of its failing); the page hears at once
        let now = State { title: title.clone(), ..State::default() };
        *p.state.lock().unwrap() = now.clone();
        let _ = app.emit_to(LABEL, STATE, now);
        // a version opened plays, though the one before was paused
        p.mpv.set_flag("pause", false)?;
        p.mpv.command(&["loadfile", &play.url, "replace", "-1", &format!("start={}", play.start)])?;
    }
    let _ = window.set_title(&title);
    // brought back from the Dock, or it would play there unseen
    let _ = window.unminimize();
    let _ = window.set_focus();
    Ok(())
}

// The player's window, the page over the picture, mpv drawing into it and an event thread hearing it.
fn create(app: &AppHandle, title: &str) -> Result<WebviewWindow, String> {
    let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("player.html".into()))
        .title(title)
        .inner_size(960.0, 540.0)
        .min_inner_size(LEAST.0, LEAST.1)
        .title_bar_style(TitleBarStyle::Overlay)
        .theme(Some(Theme::Dark))
        // black behind the picture, and the page see-through, as a background colour has wry draw none of its own
        .background_color(Color(0, 0, 0, 255))
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    match Playing::new(app, mtm, &window) {
        Ok(playing) => {
            // one left by a window still closing goes off the main thread, as on Destroyed
            if let Some(gone) = app.state::<Player>().0.lock().unwrap().replace(playing) {
                std::thread::spawn(move || drop(gone));
            }
        }
        Err(e) => {
            let _ = window.destroy();
            return Err(e);
        }
    }
    let app = app.clone();
    window.on_window_event(move |event| {
        let player = app.state::<Player>();
        match event {
            // playing stops with the window: off the main thread, which the drawing thread's last frame mustn't wait on
            WindowEvent::Destroyed => {
                if let Some(gone) = player.0.lock().unwrap().take() {
                    std::thread::spawn(move || drop(gone));
                }
            }
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                if let Some(picture) = player.0.lock().unwrap().as_ref().and_then(|p| p.picture.as_ref()) {
                    picture.rescale(*scale_factor);
                }
            }
            _ => {}
        }
    });
    Ok(window)
}

// The event thread: keeps the state as mpv tells it, and sends it to the page once a burst of events is over, till mpv
// shuts down.
fn listen(app: &AppHandle, mpv: &Mpv, state: &Mutex<State>) {
    let (mut loading, mut seeking, mut stalled) = (false, false, false);
    // the picture's size as last heard, mpv telling of a change only, and whether it changed since the file started
    // and has been fitted
    let (mut width, mut height, mut resized, mut sized) = (None, None, false, false);
    let mut wait = -1.0;
    loop {
        let event = mpv.next(wait);
        let mut s = state.lock().unwrap();
        match event {
            Event::Quiet => {
                // a file's first picture, whose size the window takes: once the burst is over, as the width and the
                // height come one after the other
                if resized && !sized && let (Some(w), Some(h)) = (width, height) {
                    sized = true;
                    fit(app, w as f64, h as f64);
                }
                let now = s.clone();
                drop(s);
                let _ = app.emit_to(LABEL, STATE, now);
                wait = -1.0;
                continue;
            }
            Event::Shutdown => return,
            Event::Log(line) => eprint!("mpv: {line}"),
            Event::StartFile => {
                (loading, resized, sized) = (true, false, false);
                s.failed = None;
            }
            Event::PlaybackRestart => loading = false,
            Event::Failed(why) => {
                loading = false;
                s.failed = Some(why);
            }
            Event::Property(id, value) => match Watched::ALL.into_iter().find(|w| *w as u64 == id) {
                Some(Watched::Pause) => s.paused = value.flag(),
                Some(Watched::Position) => s.position = value.int(),
                Some(Watched::Duration) => s.duration = value.double(),
                Some(Watched::Stalled) => stalled = value.flag(),
                Some(Watched::Seeking) => seeking = value.flag(),
                Some(Watched::Ended) => s.ended = value.flag(),
                Some(Watched::Width) => (width, resized) = (value.int(), true),
                Some(Watched::Height) => (height, resized) = (value.int(), true),
                None => {}
            },
            _ => {}
        }
        s.waiting = loading || seeking || stalled;
        // the rest of the burst, then the page hears
        wait = 0.0;
    }
}

// The window takes the video's size, as IINA's does when it opens a file: its pixels as the screen's (1080p as 960×540
// points on a Retina screen), within the screen and about where the window is; and its shape from then on, which full
// screen keeps for when it's left.
fn fit(app: &AppHandle, width: f64, height: f64) {
    if width <= 0.0 || height <= 0.0 {
        return;
    }
    let on_main = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(window) = on_main.get_webview_window(LABEL) else { return };
        let Ok(ns_window) = window.ns_window() else { return };
        let ns_window = unsafe { &*(ns_window as *const NSWindow) };
        ns_window.setContentAspectRatio(NSSize::new(width, height));
        let Some(screen) = ns_window.screen() else { return };
        if ns_window.styleMask().contains(NSWindowStyleMask::FullScreen) {
            return;
        }
        let to = fitted(width, height, ns_window.backingScaleFactor(), screen.visibleFrame(), ns_window.frame());
        ns_window.setFrame_display_animate(to, true, true);
    });
}

// Where the window goes for a video `width`×`height` pixels, on a screen of `scale` with `room` to spare: the video's
// pixels as the screen's, no smaller than the window may be and no larger than the room, its middle where the middle of
// `frame` (the window now) is, as far as the room allows.
fn fitted(width: f64, height: f64, scale: f64, room: NSRect, frame: NSRect) -> NSRect {
    let least = LEAST.0.max(LEAST.1 * width / height);
    let wide = (width / scale).max(least).min(room.size.width).min(room.size.height * width / height);
    let size = NSSize::new(wide, wide * height / width);
    let middle = |at: f64, long: f64, room_at: f64, room_long: f64, own: f64| {
        (at + (long - own) / 2.0).min(room_at + room_long - own).max(room_at)
    };
    let x = middle(frame.origin.x, frame.size.width, room.origin.x, room.size.width, size.width);
    let y = middle(frame.origin.y, frame.size.height, room.origin.y, room.size.height, size.height);
    NSRect::new(NSPoint::new(x, y), size)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
        NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
    }

    #[test]
    fn a_video_opens_at_its_own_pixels_within_the_screen_about_where_the_window_was() {
        // a MacBook's screen, its menu bar and Dock taken off, and the window as it opens
        let (room, window) = (rect(0.0, 55.0, 1512.0, 894.0), rect(276.0, 232.0, 960.0, 540.0));
        // 1080p on a Retina screen: 960×540 points, in place
        assert_eq!(fitted(1920.0, 1080.0, 2.0, room, window), window);
        // a wider picture keeps the window's middle
        assert_eq!(fitted(1920.0, 800.0, 2.0, room, window), rect(276.0, 302.0, 960.0, 400.0));
        // 4K: as big as the screen allows, and moved onto it
        assert_eq!(fitted(3840.0, 2160.0, 2.0, room, window), rect(0.0, 76.75, 1512.0, 850.5));
        // a small one no smaller than the window may be, a wide one no lower
        assert_eq!(fitted(640.0, 360.0, 2.0, room, window), rect(516.0, 367.0, 480.0, 270.0));
        assert_eq!(fitted(1280.0, 536.0, 2.0, room, window).size.height, 270.0);
    }
}
