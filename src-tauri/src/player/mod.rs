//! The player (docs/playback-plan.md): a window of its own where mpv plays a version from its own link, the picture
//! drawn under the page (player.html), whose controls float over it. player_open (src/lib.rs) opens the window, or
//! plays the next version in it; the page tells it what to do (`Command`), and hears how playing goes (`State`).

mod colour;
mod layer;
mod mpv;
mod now;
mod report;
mod symbol;

use std::ffi::c_int;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use block2::RcBlock;
use emby_core::{Beside, Play};
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2::runtime::{NSObjectProtocol, ProtocolObject};
use objc2_app_kit::{
    NSAnimatablePropertyContainer, NSAnimationContext, NSEvent, NSScreen, NSWindow, NSWindowButton, NSWindowStyleMask,
};
use objc2_foundation::{NSActivityOptions, NSPoint, NSProcessInfo, NSRect, NSSize, NSString};
use serde::{Deserialize, Serialize};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, Theme, TitleBarStyle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri::WindowEvent;

use colour::{Hdr, Look};
use layer::Picture;
use mpv::{Event, Mpv};
use now::Remote;
pub use report::Origin;
use report::{Told, due, numbered};
pub use symbol::symbol;

// the player's window, as its capability names it (capabilities/player.json)
const LABEL: &str = "player";
// what the page hears, whenever playing changes
const STATE: &str = "player://state";

// What the event thread hears of mpv: whether it's paused, where it's at and how long it is, whether it waits on the
// network or a seek, whether it's at the end, the picture's size (as shown, its aspect applied), which comes some time
// after mpv says the picture changed, the volume and whether it's muted, the file's tracks (read out whole when they
// change, which a pick does too), and how late the subtitles are put. One added here is asked for by `property`, and
// handled in `listen`.
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
    Tracks,
    SubDelay,
}

impl Watched {
    const ALL: [Watched; 12] = [
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
        Watched::Tracks,
        Watched::SubDelay,
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
            // only that they changed: they're read out then (`tracks_in`)
            Watched::Tracks => ("track-list", mpv::NONE),
            Watched::SubDelay => ("sub-delay", mpv::DOUBLE),
        }
    }
}

// the least the window may be, in points
const LEAST: (f64, f64) = (480.0, 270.0);

/// How playing goes, as the page draws it: sent whole on each change, and asked for as the page opens (player_state).
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    /// the 作品, as the page that opened the player names it: the window's title, 正在播放's (now.rs), and the page's
    /// while a version opens, as a full screen shows no title bar
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
    /// how many versions have been asked for, so a pick from a menu shown for one isn't put on the next
    opens: u64,
    /// the file's 音轨 and 字幕, as mpv has them, and how late the subtitles are put (seconds; early when less than 0)
    audio: Vec<Track>,
    subtitles: Vec<Track>,
    sub_delay: f64,
    /// the 作品 page's picks for the version opening, with its link and the 字幕 beside its file, put on as that file
    /// has opened
    #[serde(skip)]
    picks: Option<(String, Picks, Vec<Beside>)>,
    /// a version asked for and not yet started: the last file's time is told no more
    #[serde(skip)]
    next: bool,
    /// the film's HDR, by its picture's parameters, whatever the screen shows of it (`colour`)
    #[serde(skip)]
    hdr: Option<Hdr>,
    /// the version opening, as the server knows it, with its link (as `picks`), told as started once that file plays;
    /// the one playing's number once it has been (report.rs), so its progress and its stop are told; and where it last
    /// was, its stop's place, as mpv says where no more once it has stopped the file (the window closing, or a failure
    /// mid-film)
    #[serde(skip)]
    origin: Option<(String, Origin)>,
    #[serde(skip)]
    watching: Option<u64>,
    #[serde(skip)]
    last: Option<i64>,
}

impl State {
    // nothing played yet: at mpv's own volume
    fn new() -> State {
        State { volume: 100.0, ..State::default() }
    }
}

/// An 音轨 or a 字幕 of the file playing, as mpv lists it (`track-list`, read as JSON, its names): the id it's picked
/// by, what the 作品 page names one by (lib/tracks.ts): its language, title, codec and channels, whether it's forced; and
/// whether it's the one playing.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Track {
    id: i64,
    // audio, sub or video
    #[serde(rename(deserialize = "type"), skip_serializing)]
    kind: String,
    // its index in the file, FFmpeg's, which Emby's (ffprobe's) is too, so the 作品 page's pick finds it; one in a file
    // beside the video's is numbered in that file, so it's found by the file (`file`)
    // ponytail: matched by the index alone, as mpv's own mkv reader numbers tracks as FFmpeg does, though its manual
    // gives no guarantee; one numbered apart gets another track: have the page send the language to check, if one does
    #[serde(rename(deserialize = "ff-index"), skip_serializing)]
    index: Option<i64>,
    // the link of the file beside the video's it's in, as it was added (`Beside`)
    #[serde(rename(deserialize = "external-filename"), skip_serializing)]
    file: Option<String>,
    #[serde(rename(deserialize = "lang"), skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    codec: Option<String>,
    #[serde(rename(deserialize = "demux-channel-count"), skip_serializing_if = "Option::is_none")]
    channels: Option<i64>,
    forced: bool,
    selected: bool,
}

/// The 音轨 and 字幕 picked on the 作品 page, by their index in the file (Emby's), for a version opened; a 字幕 of
/// `NO_TRACK`, none. Either may be left to the file, as for one the server hasn't read.
#[derive(Clone)]
pub struct Picks {
    pub audio: Option<i64>,
    pub subtitle: Option<i64>,
}

// the index that stands for no 字幕, as the 作品 page's noTrack does (lib/tracks.ts)
const NO_TRACK: i64 = -1;

// mpv's sid for a 字幕's id, or none
fn sid_of(id: i64) -> String {
    if id == NO_TRACK { "no".into() } else { id.to_string() }
}

/// What the page asks of the player (and the Mac's own controls, `now`): to pause or play, or whichever it isn't, seek
/// to a time or by some seconds, set the volume or step it, mute or unmute, go full screen or back (or the other), show
/// the window's own title bar or hide it, as its controls are, pick the 音轨 or 字幕 (or none), and put the 字幕 later
/// or sooner, or higher. A toggle or a step is worked out here from where it is, so presses faster than the page hears
/// back add up. A pick names the version it was shown for (`State.opens`), and one shown for an earlier one is dropped,
/// as the 作品 page may have asked for another meanwhile.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Command {
    Pause { paused: bool },
    TogglePause,
    Seek { to: f64 },
    Skip { by: f64 },
    Volume { volume: f64 },
    AddVolume { by: f64 },
    ToggleMute,
    Fullscreen { on: bool },
    ToggleFullscreen,
    Chrome { shown: bool },
    Audio { id: i64, opens: u64 },
    /// `NO_TRACK` for none, as the 作品 page's picks have it
    Subtitle { id: i64, opens: u64 },
    SubDelay { by: f64 },
    /// where the 字幕 sit, in % of the window's height (100: their own place)
    SubPos { pos: f64 },
}

/// The player, as the app keeps it: nothing while its window is closed; and how playing goes, told to the server by one
/// thread for the app (report.rs), so a window closed and another opened at once tell their stop and start in order.
pub struct Player(Mutex<Option<Playing>>, Sender<Told>);

struct Playing {
    // an Option, to go first: libmpv asks for the renderer to go before the core, which the event and jobs threads hold
    picture: Option<Picture>,
    state: Arc<Mutex<State>>,
    // what's asked of mpv, done one after another, in the order asked, off the main thread (as IINA's queue does)
    jobs: Sender<Job>,
    // the Mac's media keys and 正在播放, taken while the player is open
    _remote: Remote,
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
            // the screen's profile (colour.rs) as a black that's black, as Apple's display profiles have (the XDR's,
            // Display P3): mpv reads that black as a contrast past its range and draws a film grey or black, so it's
            // taken as BT.1886's pure 2.4 power
            // ponytail: a calibrated profile's measured black loses the lift BT.1886 gives its shadows; set this per
            // profile, by the black lcms reads in it, if one of those turns up
            ("icc-force-contrast", "inf"),
        ])?);
        for watched in Watched::ALL {
            let (name, format) = watched.property();
            mpv.observe(watched as u64, name, format)?;
        }
        // a file opened, before mpv picks its tracks and starts reading them: where the 作品 page's picks go on
        // (`listen`), so it reads those from the start, not asking the network again for them once it's reading others
        mpv.hook("on_preloaded")?;
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
                let (app, mpv, state, tell) = (app.clone(), mpv.clone(), state.clone(), app.state::<Player>().1.clone());
                move || listen(&app, &mpv, &state, &tell)
            })
            .map_err(|e| e.to_string())?;
        Ok(Playing { picture: Some(picture), state, jobs, _remote: Remote::take(app) })
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
    pub fn new(app: &AppHandle) -> Result<Player, String> {
        Ok(Player(Mutex::default(), report::reporter(app)?))
    }

    pub fn state(&self) -> State {
        let playing = self.0.lock().unwrap();
        playing.as_ref().map_or_else(State::new, |p| p.state.lock().unwrap().clone())
    }

    pub fn command(&self, app: &AppHandle, command: Command) {
        // the version a pick was shown for, checked as it's queued (below)
        let mut shown_for = None;
        let job: Job = match command {
            // the window's, done at once, needing no mpv; a toggle mid-way waits for the change under way (tao)
            Command::Fullscreen { on } => return fullscreen(app, |_| on),
            Command::ToggleFullscreen => return fullscreen(app, |window| !window.is_fullscreen().unwrap_or_default()),
            Command::Chrome { shown } => return chrome(app, shown),
            Command::Pause { paused: true } => Box::new(|mpv| mpv.set_flag("pause", true)),
            Command::Pause { paused: false } => Box::new(play),
            Command::TogglePause => Box::new(|mpv| if mpv.flag("pause")? { play(mpv) } else { mpv.set_flag("pause", true) }),
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
            Command::Audio { id, opens } => {
                shown_for = Some(opens);
                Box::new(move |mpv| mpv.command(&["set", "aid", &id.to_string()]))
            }
            Command::Subtitle { id, opens } => {
                shown_for = Some(opens);
                Box::new(move |mpv| mpv.command(&["set", "sid", &sid_of(id)]))
            }
            Command::SubDelay { by } => Box::new(move |mpv| mpv.command(&["add", "sub-delay", &by.to_string()])),
            Command::SubPos { pos } => Box::new(move |mpv| mpv.set_double("sub-pos", pos.clamp(0.0, 100.0))),
        };
        // checked and queued under the lock open_here counts and queues a version under, so a pick is either in the queue
        // before that version's loadfile or seen to be shown for the last one
        if let Some(p) = self.0.lock().unwrap().as_ref() {
            if shown_for.is_some_and(|opens| opens != p.state.lock().unwrap().opens) {
                return;
            }
            let _ = p.jobs.send(job);
        }
    }
}

// The file's 音轨 and 字幕 in mpv's track list (its JSON); its video tracks and any of a type it adds are left out.
fn tracks_in(list: &str) -> (Vec<Track>, Vec<Track>) {
    let (mut audio, mut subtitles) = (vec![], vec![]);
    let listed = serde_json::from_str::<Vec<Track>>(list).unwrap_or_else(|e| {
        eprintln!("player: the track list: {e}");
        vec![]
    });
    for mut track in listed {
        // one beside the file added with no title of its own mpv titles by its file's name, Emby's Stream.ass
        if let (Some(file), Some(title)) = (&track.file, &track.title)
            && file.ends_with(&format!("/{title}"))
        {
            track.title = None;
        }
        match track.kind.as_str() {
            "audio" => audio.push(track),
            "sub" => subtitles.push(track),
            _ => {}
        }
    }
    (audio, subtitles)
}

// The 作品 page's picks as mpv's sets: the 音轨's and the 字幕's ids (or no 字幕), found among the file's tracks by
// their index in it, or one `beside` it by its link; one not found (one beside it that couldn't be read) is left to
// the file.
fn picked((audio, subtitles): &(Vec<Track>, Vec<Track>), picks: &Picks, beside: &[Beside]) -> Vec<(&'static str, String)> {
    let id = |tracks: &[Track], index: i64| {
        let file = beside.iter().find(|b| i64::from(b.track.index) == index).map(|b| b.link.as_str());
        let found = tracks.iter().find(|t| match file {
            Some(link) => t.file.as_deref() == Some(link),
            None => t.file.is_none() && t.index == Some(index),
        });
        found.map(|t| t.id.to_string())
    };
    let aid = picks.audio.and_then(|index| id(audio, index));
    let sid = match picks.subtitle {
        Some(NO_TRACK) => Some(sid_of(NO_TRACK)),
        Some(index) => id(subtitles, index),
        None => None,
    };
    [("aid", aid), ("sid", sid)].into_iter().filter_map(|(name, id)| Some((name, id?))).collect()
}

// Plays: at the end, where keep-open holds it paused on the last frame, from the start again. (`eof-reached` has no
// value while a version opens, which playing is still for.)
fn play(mpv: &Mpv) -> Result<(), String> {
    if mpv.flag("eof-reached").unwrap_or(false) {
        mpv.command(&["seek", "0", "absolute"])?;
    }
    mpv.set_flag("pause", false)
}

// Full screen or back, as `on` says of the window as it is now.
fn fullscreen(app: &AppHandle, on: impl FnOnce(&WebviewWindow) -> bool) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.set_fullscreen(on(&window));
    }
}

/// Plays `play` in the player's window, opening it if it's closed, from where the user left off; `origin`, the version
/// as the server knows it, is told how playing goes.
pub async fn open(app: &AppHandle, play: Play, title: String, picks: Picks, origin: Origin) -> Result<(), String> {
    // on the main thread, where windows and their views are made
    let (done, mut answer) = tauri::async_runtime::channel(1);
    let on_main = app.clone();
    app.run_on_main_thread(move || {
        let _ = done.try_send(open_here(&on_main, &play, title, picks, origin));
    })
    .map_err(|e| e.to_string())?;
    answer.recv().await.unwrap_or_else(|| Err("the main thread didn't answer".into()))
}

fn open_here(app: &AppHandle, play: &Play, title: String, picks: Picks, origin: Origin) -> Result<(), String> {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => create(app, &title)?,
    };
    {
        let player = app.state::<Player>();
        let playing = player.0.lock().unwrap();
        let p = playing.as_ref().ok_or("the player has closed")?;
        // what's playing now, which the page hears at once, opening from here: the last file's time is told no more,
        // so what mpv says of it as it ends (its options put back) is no one's change and the corner tells nothing; the
        // rest of its state goes when mpv starts this one (`listen`)
        let mut s = p.state.lock().unwrap();
        // the last one told as stopped where it got to, before this one's start, which waits till it plays
        // none where it got to isn't known, as 0 would wipe the user's place (the next start stops it where last told)
        if let (Some(n), Some(at)) = (s.watching.take(), s.last) {
            let _ = player.1.send(Told::Stopped(n, at as f64));
        }
        s.origin = Some((play.url.clone(), origin));
        (s.title, s.from, s.position, s.next) = (title.clone(), (play.start > 0.0).then_some(play.start), None, true);
        s.opens += 1;
        s.picks = Some((play.url.clone(), picks, play.beside.clone()));
        let _ = app.emit_to(LABEL, STATE, s.clone());
        drop(s);
        // through the queue, after what was asked of the version before, which mustn't land in this one; it starts on
        // its own 音轨 and 字幕, playing, its 字幕 on time, whatever was changed before (a pick of the 作品 page's is
        // put on after, `listen`), as the file's own options, which mpv sets once it has started it
        let (url, options) = (play.url.clone(), format!("start={},aid=auto,sid=auto,pause=no,sub-delay=0", play.start));
        let (app, state) = (app.clone(), p.state.clone());
        let _ = p.jobs.send(Box::new(move |mpv| {
            let asked = mpv.command(&["loadfile", &url, "replace", "-1", &options]);
            // refused, no file starts and nothing else would tell: a failure, not an opening that never ends, and the
            // last file stopped, as it's no longer the one named
            if let Err(why) = &asked {
                let _ = mpv.command(&["stop"]);
                let mut s = state.lock().unwrap();
                (s.failed, s.next, s.picks) = (Some(why.clone()), false, None);
                let _ = app.emit_to(LABEL, STATE, s.clone());
            }
            asked
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
            // another screen, whose colours and headroom the picture takes too
            // ponytail: heard only when the scale changes; a window dragged to a screen of the same scale, or a screen
            // given another profile or preset (an XDR's reference modes), keeps the last colours till the next film.
            // Hear NSWindowDidChangeScreenNotification and NSWindowDidChangeScreenProfileNotification if that matters.
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                if let Some(picture) = player.0.lock().unwrap().as_ref().and_then(|p| p.picture.as_ref()) {
                    picture.rescale(*scale_factor);
                }
                // after this event's handling, as on the main thread the look would be made inside it, which may write
                let app = app.clone();
                std::thread::spawn(move || colour(&app));
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
fn listen(app: &AppHandle, mpv: &Mpv, state: &Mutex<State>, tell: &Sender<Told>) {
    let (mut loading, mut seeking, mut stalled) = (false, false, false);
    // where it was last told to be, and whether paused (report.rs)
    let mut told: Option<(i64, bool)> = None;
    // the picture's size as last heard, mpv telling of a change only, and whether it changed since the file started
    // and has been fitted
    let (mut width, mut height, mut resized, mut sized) = (None, None, false, false);
    // while it plays, the screen doesn't dim or sleep, as IINA keeps it (SleepPreventer.swift); paused or done, it may
    let mut awake: Option<Activity> = None;
    let mut teller = now::Teller::default();
    let info = NSProcessInfo::processInfo();
    let let_sleep = |awake: &mut Option<Activity>| {
        if let Some(activity) = awake.take() {
            unsafe { info.endActivity(&activity) };
        }
    };
    let mut wait = -1.0;
    loop {
        let event = mpv.next(wait);
        // a file opened, mpv waiting to pick its tracks: the 字幕 beside it go in, unpicked, then the 作品 page's picks go
        // on; mpv asked with the state let go, as the main thread waits on it
        if let Event::Hook(hook) = event {
            let path = mpv.string("path");
            let picks = state.lock().unwrap().picks.take_if(|(link, ..)| path.as_ref() == Some(link));
            if let Some((_, picks, beside)) = picks {
                for b in &beside {
                    let (title, language) = (b.track.title.as_deref(), b.track.language.as_deref());
                    let add = ["sub-add", &b.link, "auto", title.unwrap_or(""), language.unwrap_or("")];
                    // each read from the server, 0.5–1.2 s on the user's: the one picked before the film starts, so
                    // it's among those mpv picks from (put on below), the rest as it plays, which mpv drops as the file
                    // ends (measured); one that can't be read is in mpv's log
                    // ponytail: a server that hangs on the one picked holds the start up to mpv's network timeout (60
                    // s), though it has just answered for the 作品; read it as the rest are and put it on once it's in
                    // (mpv only marks one that comes between picking and playing) if that turns up
                    let picked = picks.subtitle == Some(i64::from(b.track.index));
                    let _ = if picked { mpv.command(&add) } else { mpv.command_async(&add) };
                }
                for (name, id) in picked(&tracks_in(&mpv.string("track-list").unwrap_or_default()), &picks, &beside) {
                    let _ = mpv.command(&["set", name, &id]);
                }
            }
            let _ = mpv.proceed(hook);
            continue;
        }
        // the file's tracks, read out when they change, with the state let go too; and once a file plays, its picture's
        // HDR, by its transfer and primaries, known by then, read once a file (the window may be on another screen by
        // now), as mpv tells of no change of them between two files alike; and which file it is, whose start is told
        let tracks = matches!(event, Event::Property(id, _) if id == Watched::Tracks as u64)
            .then(|| tracks_in(&mpv.string("track-list").unwrap_or_default()));
        let opened = (loading && matches!(event, Event::PlaybackRestart)).then(|| {
            let read = |name| mpv.string(name).unwrap_or_default();
            (Hdr::of(&read("video-params/gamma"), &read("video-params/primaries")), read("path"))
        });
        let mut s = state.lock().unwrap();
        match event {
            Event::Quiet => {
                // a file's first picture, whose size the window takes: once the burst is over, as the width and the
                // height come one after the other
                if resized && !sized && let (Some(w), Some(h)) = (width, height) {
                    sized = true;
                    fit(app, w as f64, h as f64);
                }
                if let (Some(n), false, Some(at)) = (s.watching, s.next, s.position) && due(told, at, s.paused) {
                    let _ = tell.send(Told::Progress(n, at as f64, s.paused));
                    told = Some((at, s.paused));
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
                teller.tell(app, &now);
                let _ = app.emit_to(LABEL, STATE, now);
                wait = -1.0;
                continue;
            }
            // the window closed: what played told as stopped where it got to
            Event::Shutdown => {
                if let (Some(n), Some(at)) = (s.watching, s.last) {
                    let _ = tell.send(Told::Stopped(n, at as f64));
                }
                let_sleep(&mut awake);
                return;
            }
            Event::Log(line) => eprint!("mpv: {line}"),
            // a file starting, in order after the last one's events, so its state goes here: the page's wait shows
            Event::StartFile => {
                (loading, resized, sized) = (true, false, false);
                (s.position, s.duration, s.ended, s.failed, s.next, s.hdr, s.last) =
                    (None, None, false, None, false, None, None);
            }
            // after the file's opening or a seek, which the page's corner tells
            Event::PlaybackRestart => {
                if let Some((hdr, path)) = opened {
                    s.hdr = hdr;
                    colour(app);
                    // the version asked for plays: told as started (not the last one, still opening as this was asked)
                    if let Some((_, origin)) = s.origin.take_if(|(link, _)| *link == path) {
                        let at = s.position.or(s.from.map(|f| f as i64)).unwrap_or(0);
                        let n = numbered();
                        let _ = tell.send(Told::Started(n, origin, at as f64));
                        (s.watching, s.last) = (Some(n), Some(at));
                        told = Some((at, s.paused));
                    }
                } else {
                    s.seeks += 1;
                }
                loading = false;
            }
            // its HDR, if the last film's was, no longer shown behind the failure
            Event::Failed(why) => {
                loading = false;
                (s.failed, s.hdr) = (Some(why), None);
                colour(app);
            }
            Event::Property(id, value) => match Watched::ALL.into_iter().find(|w| *w as u64 == id) {
                Some(Watched::Pause) => s.paused = value.flag(),
                Some(Watched::Position) => {
                    if !s.next {
                        s.position = value.int();
                        s.last = s.position.or(s.last);
                    }
                }
                Some(Watched::Duration) => s.duration = value.double(),
                Some(Watched::Stalled) => stalled = value.flag(),
                Some(Watched::Seeking) => seeking = value.flag(),
                Some(Watched::Ended) => s.ended = value.flag(),
                Some(Watched::Width) => (width, resized) = (value.int(), true),
                Some(Watched::Height) => (height, resized) = (value.int(), true),
                Some(Watched::Volume) => s.volume = value.double().unwrap_or(s.volume),
                Some(Watched::Muted) => s.muted = value.flag(),
                Some(Watched::Tracks) => (s.audio, s.subtitles) = tracks.unwrap_or_default(),
                Some(Watched::SubDelay) => s.sub_delay = value.double().unwrap_or(0.0),
                None => {}
            },
            _ => {}
        }
        s.waiting = loading || seeking || stalled;
        // the rest of the burst, then the page hears
        wait = 0.0;
    }
}

// The picture's colours for the film (`State.hdr`) on the window's screen now (colour.rs): the layer's at once, on the
// main thread, as AppKit reads the screen there, and mpv's queued.
fn colour(app: &AppHandle) {
    on_window(app, |app, ns_window| {
        // a window between screens, or minimised, has none: the main one's, till the next film
        let Some(screen) = ns_window.screen().or_else(|| NSScreen::mainScreen(MainThreadMarker::new()?)) else { return };
        let cache = app.path().app_cache_dir().ok();
        let player = app.state::<Player>();
        // read, and the locks let go, as the look may write the screen's profile
        let (hdr, floats) = {
            let playing = player.0.lock().unwrap();
            let Some(p) = playing.as_ref() else { return };
            (p.state.lock().unwrap().hdr, p.picture.as_ref().is_some_and(Picture::floats))
        };
        let look = Look::on(&screen, hdr, floats, cache.as_deref());
        let playing = player.0.lock().unwrap();
        let Some(p) = playing.as_ref() else { return };
        if let Some(picture) = &p.picture {
            picture.colour(&look.space, look.edr);
        }
        let target = look.target;
        let _ = p.jobs.send(Box::new(move |mpv| target.apply(mpv)));
    });
}

// Runs `f` on the main thread, where AppKit is used, with the player's window; nothing once it's gone.
fn on_window(app: &AppHandle, f: impl FnOnce(&AppHandle, &NSWindow) + Send + 'static) {
    let on_main = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(window) = on_main.get_webview_window(LABEL) else { return };
        let Ok(ns_window) = window.ns_window() else { return };
        f(&on_main, unsafe { &*(ns_window as *const NSWindow) });
    });
}

// The window takes the video's size, as IINA's does when it opens a file: its pixels as the screen's (1080p as 960×540
// points on a Retina screen), within the screen and about where the window is; and its shape from then on, which full
// screen keeps for when it's left.
fn fit(app: &AppHandle, width: f64, height: f64) {
    if width <= 0.0 || height <= 0.0 {
        return;
    }
    on_window(app, move |_, ns_window| {
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
    on_window(&app, move |app, ns_window| {
        if ASKED.load(Ordering::Relaxed) != asked {
            return;
        }
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
                let app = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(500));
                    fade(app, shown, asked);
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
    use serde_json::json;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
        NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
    }

    // mpv's list for a film with two 音轨 and two 字幕, and a 字幕 beside it (some of each track's keys; the last ones'
    // flags left out)
    const LIST: &str = r#"[
        {"id":1,"type":"video","ff-index":0,"codec":"h264","default":true,"forced":false,"selected":true},
        {"id":1,"type":"audio","ff-index":1,"lang":"chi","title":"国语","codec":"aac","demux-channel-count":1,"forced":false,"selected":false},
        {"id":2,"type":"audio","ff-index":2,"lang":"eng","title":"Commentary","codec":"ac3","demux-channel-count":6,"forced":false,"selected":true},
        {"id":1,"type":"sub","ff-index":3,"codec":"hdmv_pgs_subtitle","forced":true,"selected":true},
        {"id":2,"type":"sub","ff-index":4,"lang":"eng","codec":"subrip"},
        {"id":3,"type":"sub","ff-index":0,"lang":"zh-CN","title":"Stream.ass","codec":"ass","external":true,"external-filename":"https://emby.example/emby/Videos/m1/v1/Subtitles/6/Stream.ass"}
    ]"#;

    #[test]
    fn a_files_tracks_are_its_audio_and_subtitles_as_mpv_lists_them() {
        let (audio, subtitles) = tracks_in(LIST);
        let read: Vec<_> = audio.iter().map(|t| (t.id, t.index, t.channels)).collect();
        assert_eq!(read, [(1, Some(1), Some(1)), (2, Some(2), Some(6))]);
        // as the page has them: not mpv's names, nor its type and the index in the file
        assert_eq!(
            serde_json::to_value(&audio[1]).unwrap(),
            json!({"id":2,"language":"eng","title":"Commentary","codec":"ac3","channels":6,"forced":false,"selected":true})
        );
        assert_eq!(
            serde_json::to_value(&subtitles).unwrap(),
            json!([
                {"id":1,"codec":"hdmv_pgs_subtitle","forced":true,"selected":true},
                {"id":2,"language":"eng","codec":"subrip","forced":false,"selected":false},
                {"id":3,"language":"zh-CN","codec":"ass","forced":false,"selected":false}
            ])
        );
        // nothing read, nothing listed
        assert!(tracks_in("").0.is_empty());
    }

    #[test]
    fn the_pages_picks_are_mpvs_tracks_of_the_same_index_in_the_file() {
        let tracks = tracks_in(LIST);
        let track = emby_core::Track {
            index: 6,
            language: Some("zh-CN".into()),
            title: None,
            codec: Some("ass".into()),
            channels: None,
            default: false,
            forced: false,
            external: true,
        };
        let beside = [Beside { track, link: "https://emby.example/emby/Videos/m1/v1/Subtitles/6/Stream.ass".into() }];
        let sets = |audio, subtitle| picked(&tracks, &Picks { audio, subtitle }, &beside);
        assert_eq!(sets(Some(1), Some(4)), [("aid", "1".to_string()), ("sid", "2".to_string())]);
        assert_eq!(sets(None, Some(NO_TRACK)), [("sid", "no".to_string())]);
        // one beside the file, by its link, not the index it has in its own file
        assert_eq!(sets(None, Some(6)), [("sid", "3".to_string())]);
        assert!(sets(None, Some(0)).is_empty());
        // one the file hasn't, left to the file
        assert!(sets(Some(9), None).is_empty());
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
