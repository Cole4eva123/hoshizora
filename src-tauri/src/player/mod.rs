//! The player (docs/playback-plan.md): a window of its own where mpv plays a version from its own link, the picture
//! drawn under the page (player.html), whose controls float over it. player_open (src/lib.rs) opens the window, or
//! plays the next version in it; the page tells it what to do (`Command`), and hears how playing goes (`State`).

mod layer;
mod mpv;

use std::ffi::c_int;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use block2::RcBlock;
use emby_core::Play;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2::runtime::{NSObjectProtocol, ProtocolObject};
use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSEvent, NSWindow, NSWindowButton, NSWindowStyleMask};
use objc2_foundation::{NSActivityOptions, NSPoint, NSProcessInfo, NSRect, NSSize, NSString};
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
// network or a seek, whether it's at the end, the picture's size (as shown, its aspect applied), which comes some time
// after mpv says the picture changed, and the volume and whether it's muted. One added here is asked for by
// `property`, and handled in `listen`.
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
    Volume,
    Muted,
}

impl Watched {
    const ALL: [Watched; 10] = [
        Watched::Pause,
        Watched::Position,
        Watched::Duration,
        Watched::Stalled,
        Watched::Seeking,
        Watched::Ended,
        Watched::Width,
        Watched::Height,
        Watched::Volume,
        Watched::Muted,
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
            // 0 to 100
            Watched::Volume => ("volume", mpv::DOUBLE),
            Watched::Muted => ("mute", mpv::FLAG),
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
    /// where it picks up, seconds in, when the user left off there
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<f64>,
    /// 0 to 100
    volume: f64,
    muted: bool,
    /// the window full screen
    fullscreen: bool,
    /// how many seeks have landed, for the page's corner to tell where
    seeks: u64,
}

impl State {
    // nothing played yet: at mpv's own volume
    fn new() -> State {
        State { volume: 100.0, ..State::default() }
    }
}

/// What the page asks of the player: to pause or play (whichever it isn't), seek to a time or by some seconds,
/// set the volume or step it, mute or unmute, go full screen or back (or the other), and show the window's own title bar
/// or hide it, as its controls are. A toggle or a step is worked out here from where it is, so presses faster than the
/// page hears back add up.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Command {
    TogglePause,
    Seek { to: f64 },
    Skip { by: f64 },
    Volume { volume: f64 },
    AddVolume { by: f64 },
    ToggleMute,
    Fullscreen { on: bool },
    ToggleFullscreen,
    Chrome { shown: bool },
}

/// The player, as the app keeps it: nothing while its window is closed.
#[derive(Default)]
pub struct Player(Mutex<Option<Playing>>);

struct Playing {
    // an Option, to go first: libmpv asks for the renderer to go before the core, which the event and jobs threads hold
    picture: Option<Picture>,
    state: Arc<Mutex<State>>,
    // what's asked of mpv, done one after another, in the order asked, off the main thread (as IINA's queue does)
    jobs: Sender<Job>,
}

// one thing asked of mpv, done on the jobs' thread
type Job = Box<dyn FnOnce(&Mpv) -> Result<(), String> + Send>;

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
            // the page's slider runs to 100, mpv's own to 130
            ("volume-max", "100"),
        ])?);
        for watched in Watched::ALL {
            let (name, format) = watched.property();
            mpv.observe(watched as u64, name, format)?;
        }
        // before anything plays, as mpv's video output needs the renderer
        let picture = Picture::new(mtm, ns_window, &mpv)?;
        let state = Arc::new(Mutex::new(State::new()));
        let (jobs, queue) = channel::<Job>();
        std::thread::Builder::new()
            .name("mpv jobs".into())
            .spawn({
                let mpv = mpv.clone();
                move || {
                    for job in queue {
                        if let Err(e) = job(&mpv) {
                            eprintln!("player: {e}");
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        std::thread::Builder::new()
            .name("mpv events".into())
            .spawn({
                let (app, mpv, state) = (app.clone(), mpv.clone(), state.clone());
                move || listen(&app, &mpv, &state)
            })
            .map_err(|e| e.to_string())?;
        Ok(Playing { picture: Some(picture), state, jobs })
    }
}

impl Drop for Playing {
    fn drop(&mut self) {
        drop(self.picture.take());
        // the core quits after what's queued, and goes with the last of its handles: the event thread's, once it hears,
        // or the jobs thread's, once its queue (this one's sender) is gone
        let _ = self.jobs.send(Box::new(|mpv| mpv.command(&["quit"])));
    }
}

impl Player {
    pub fn state(&self) -> State {
        let playing = self.0.lock().unwrap();
        playing.as_ref().map_or_else(State::new, |p| p.state.lock().unwrap().clone())
    }

    pub fn command(&self, app: &AppHandle, command: Command) {
        let job: Job = match command {
            // the window's, done at once, needing no mpv; a toggle mid-way waits for the change under way (tao)
            Command::Fullscreen { on } => return fullscreen(app, |_| on),
            Command::ToggleFullscreen => return fullscreen(app, |window| !window.is_fullscreen().unwrap_or_default()),
            Command::Chrome { shown } => return chrome(app, shown),
            // at the end, where keep-open holds it paused on the last frame, playing again starts it over
            Command::TogglePause => Box::new(|mpv| {
                // none while a version opens, which pausing is still for
                if mpv.flag("eof-reached").unwrap_or(false) {
                    mpv.command(&["seek", "0", "absolute"])?;
                    mpv.set_flag("pause", false)
                } else {
                    mpv.command(&["cycle", "pause"])
                }
            }),
            Command::Seek { to } => Box::new(move |mpv| mpv.command(&["seek", &to.to_string(), "absolute"])),
            // exact, as mpv's relative seeks go to a keyframe, which a film may have only every 10 s
            Command::Skip { by } => Box::new(move |mpv| mpv.command(&["seek", &by.to_string(), "relative+exact"])),
            // a change of volume unmutes, as a native player's does
            Command::Volume { volume } => Box::new(move |mpv| {
                mpv.set_flag("mute", false)?;
                mpv.set_double("volume", volume.clamp(0.0, 100.0))
            }),
            Command::AddVolume { by } => Box::new(move |mpv| {
                mpv.set_flag("mute", false)?;
                mpv.command(&["add", "volume", &by.to_string()])
            }),
            Command::ToggleMute => Box::new(|mpv| mpv.command(&["cycle", "mute"])),
        };
        if let Some(p) = self.0.lock().unwrap().as_ref() {
            let _ = p.jobs.send(job);
        }
    }
}

// Full screen or back, as `on` says of the window as it is now.
fn fullscreen(app: &AppHandle, on: impl FnOnce(&WebviewWindow) -> bool) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.set_fullscreen(on(&window));
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
        // what's playing now, which the page hears at once; the rest of the last file's state goes when mpv starts this
        // one (`listen`), as till then it still tells of the last
        let mut s = p.state.lock().unwrap();
        (s.title, s.from) = (title.clone(), (play.start > 0.0).then_some(play.start));
        let _ = app.emit_to(LABEL, STATE, s.clone());
        drop(s);
        // through the queue, after what was asked of the version before, which mustn't land in this one; it plays,
        // though the one before was paused
        let (url, start) = (play.url.clone(), format!("start={}", play.start));
        let _ = p.jobs.send(Box::new(move |mpv| {
            mpv.set_flag("pause", false)?;
            mpv.command(&["loadfile", &url, "replace", "-1", &start])
        }));
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
            // full screen, or back, which the page shows on its button
            WindowEvent::Resized(_) => {
                let on = app.get_webview_window(LABEL).is_some_and(|w| w.is_fullscreen().unwrap_or_default());
                if let Some(p) = player.0.lock().unwrap().as_ref() {
                    let mut s = p.state.lock().unwrap();
                    if s.fullscreen != on {
                        s.fullscreen = on;
                        let _ = app.emit_to(LABEL, STATE, s.clone());
                    }
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

// what NSProcessInfo hands back for an activity begun, to end it with
type Activity = Retained<ProtocolObject<dyn NSObjectProtocol>>;

// The event thread: keeps the state as mpv tells it, and sends it to the page once a burst of events is over, till mpv
// shuts down.
fn listen(app: &AppHandle, mpv: &Mpv, state: &Mutex<State>) {
    let (mut loading, mut seeking, mut stalled) = (false, false, false);
    // the picture's size as last heard, mpv telling of a change only, and whether it changed since the file started
    // and has been fitted
    let (mut width, mut height, mut resized, mut sized) = (None, None, false, false);
    // while it plays, the screen doesn't dim or sleep, as IINA keeps it (SleepPreventer.swift); paused or done, it may
    let mut awake: Option<Activity> = None;
    let info = NSProcessInfo::processInfo();
    let let_sleep = |awake: &mut Option<Activity>| {
        if let Some(activity) = awake.take() {
            unsafe { info.endActivity(&activity) };
        }
    };
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
                let playing = !s.paused && !s.ended && s.failed.is_none() && s.position.is_some();
                if playing && awake.is_none() {
                    let options = NSActivityOptions::IdleDisplaySleepDisabled | NSActivityOptions::UserInitiated;
                    awake = Some(info.beginActivityWithOptions_reason(options, &NSString::from_str("放映室在播放")));
                } else if !playing {
                    let_sleep(&mut awake);
                }
                let now = s.clone();
                drop(s);
                let _ = app.emit_to(LABEL, STATE, now);
                wait = -1.0;
                continue;
            }
            Event::Shutdown => {
                let_sleep(&mut awake);
                return;
            }
            Event::Log(line) => eprint!("mpv: {line}"),
            // a file starting, in order after the last one's events, so its state goes here: the page's title card shows
            Event::StartFile => {
                (loading, resized, sized) = (true, false, false);
                (s.position, s.duration, s.ended, s.failed) = (None, None, false, None);
            }
            // after the file's opening or a seek, which the page's corner tells
            Event::PlaybackRestart => {
                if !loading {
                    s.seeks += 1;
                }
                loading = false;
            }
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
                Some(Watched::Volume) => s.volume = value.double().unwrap_or(s.volume),
                Some(Watched::Muted) => s.muted = value.flag(),
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

// The window's own title bar, its buttons and title, goes and comes with the page's controls, fading as they do (0.3 s,
// the page's duration-300); once gone it's hidden too, as a see-through button still takes a click. While the pointer is
// on it, where the page hears no moves, it stays, and is asked again in a moment. In full screen it's left whole, as
// macOS shows it at the top edge.
fn chrome(app: &AppHandle, shown: bool) {
    fade(app.clone(), shown, ASKED.fetch_add(1, Ordering::Relaxed) + 1);
}

// the latest ask, so one asked again knows when it's been overtaken
static ASKED: AtomicU64 = AtomicU64::new(0);

fn fade(app: AppHandle, shown: bool, asked: u64) {
    let on_main = app.clone();
    let _ = app.run_on_main_thread(move || {
        if ASKED.load(Ordering::Relaxed) != asked {
            return;
        }
        let Some(window) = on_main.get_webview_window(LABEL) else { return };
        let Ok(ns_window) = window.ns_window() else { return };
        let ns_window = unsafe { &*(ns_window as *const NSWindow) };
        // the buttons' bar, as wry finds it to move them: the close button's superview's superview
        let close = ns_window.standardWindowButton(NSWindowButton::CloseButton);
        let Some(bar) = close.and_then(|b| unsafe { b.superview()?.superview() }) else { return };
        if ns_window.styleMask().contains(NSWindowStyleMask::FullScreen) {
            bar.setHidden(false);
            bar.setAlphaValue(1.0);
            return;
        }
        if shown {
            bar.setHidden(false);
        } else {
            let (at, frame) = (NSEvent::mouseLocation(), ns_window.frame());
            let top = frame.origin.y + frame.size.height;
            let across = frame.origin.x <= at.x && at.x <= frame.origin.x + frame.size.width;
            if across && top - bar.frame().size.height <= at.y && at.y <= top {
                // ponytail: a short thread every half second while the pointer rests there, to look again; a tracking
                // area on the title bar would hear it leave instead, if this ever shows up
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(500));
                    fade(on_main, shown, asked);
                });
                return;
            }
        }
        let fading = bar.clone();
        let fade = RcBlock::new(move |context: NonNull<NSAnimationContext>| {
            unsafe { context.as_ref() }.setDuration(0.3);
            fading.animator().setAlphaValue(if shown { 1.0 } else { 0.0 });
        });
        // hidden only if nothing has shown it again meanwhile
        let done = RcBlock::new(move || {
            if !shown && bar.alphaValue() == 0.0 {
                bar.setHidden(true);
            }
        });
        NSAnimationContext::runAnimationGroup_completionHandler(&fade, Some(&done));
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
