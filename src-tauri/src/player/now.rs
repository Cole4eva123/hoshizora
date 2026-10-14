//! The Mac's own controls for what plays: 正在播放 in Control Center and on the lock screen, and the media keys (F8, a
//! headset's buttons), as IINA has them (NowPlayingInfoManager.swift, RemoteCommandController.swift). What's playing and
//! where is told after each burst of mpv's events; what's asked from there goes to the player as the page's commands do.
//! All of it on the main thread, where MediaPlayer's objects live.

use std::ptr::NonNull;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};
use objc2_media_player::{
    MPChangePlaybackPositionCommandEvent, MPMediaItemPropertyPlaybackDuration, MPMediaItemPropertyTitle,
    MPNowPlayingInfoCenter, MPNowPlayingInfoMediaType, MPNowPlayingInfoPropertyElapsedPlaybackTime,
    MPNowPlayingInfoPropertyMediaType, MPNowPlayingInfoPropertyPlaybackRate, MPNowPlayingPlaybackState, MPRemoteCommand,
    MPRemoteCommandCenter, MPRemoteCommandEvent, MPRemoteCommandHandlerStatus,
};
use tauri::{AppHandle, Manager};

use super::{Command, Player, State};

// a skip from Control Center or a headset, as the page's arrows are 5 s and a remote's buttons are fewer; the controls'
// ◀◀ ▶▶ skip as far (pages/Player.tsx `step.skip`)
const SKIP: f64 = 10.0;

/// The Mac's commands, taken while the player is open, and given back (with 正在播放 cleared) when it closes.
pub struct Remote {
    app: AppHandle,
    taken: Vec<(Retained<MPRemoteCommand>, Retained<AnyObject>)>,
}

// made on the main thread and given back there (`Drop`); released elsewhere only as the app quits, and never used
unsafe impl Send for Remote {}

impl Remote {
    /// Takes the Mac's play, pause, skip and seek commands for the player. On the main thread.
    pub fn take(app: &AppHandle) -> Remote {
        let center = unsafe { MPRemoteCommandCenter::sharedCommandCenter() };
        let mut taken = Vec::new();
        let mut to = |command: Retained<MPRemoteCommand>, asked: fn(&MPRemoteCommandEvent) -> Command| {
            let app = app.clone();
            let handler = RcBlock::new(move |event: NonNull<MPRemoteCommandEvent>| {
                app.state::<Player>().command(&app, asked(unsafe { event.as_ref() }));
                MPRemoteCommandHandlerStatus::Success
            });
            let target = unsafe { command.addTargetWithHandler(&handler) };
            taken.push((command, target));
        };
        // the scrubber in Control Center, whose event is the position's kind
        let position = |event: &MPRemoteCommandEvent| {
            let event = unsafe { &*(event as *const MPRemoteCommandEvent).cast::<MPChangePlaybackPositionCommandEvent>() };
            Command::Seek { to: unsafe { event.positionTime() } }
        };
        let intervals = NSArray::from_retained_slice(&[NSNumber::new_f64(SKIP)]);
        unsafe {
            // those not handled, off, as IINA has them, so Control Center and a headset don't offer them
            for command in [
                center.nextTrackCommand(),
                center.previousTrackCommand(),
                center.seekForwardCommand(),
                center.seekBackwardCommand(),
                Retained::into_super(center.changePlaybackRateCommand()),
                Retained::into_super(center.ratingCommand()),
                Retained::into_super(center.likeCommand()),
                Retained::into_super(center.dislikeCommand()),
                Retained::into_super(center.bookmarkCommand()),
            ] {
                command.setEnabled(false);
            }
            to(center.playCommand(), |_| Command::Pause { paused: false });
            to(center.pauseCommand(), |_| Command::Pause { paused: true });
            to(center.togglePlayPauseCommand(), |_| Command::TogglePause);
            let forward = center.skipForwardCommand();
            forward.setPreferredIntervals(&intervals);
            to(Retained::into_super(forward), |_| Command::Skip { by: SKIP });
            let backward = center.skipBackwardCommand();
            backward.setPreferredIntervals(&intervals);
            to(Retained::into_super(backward), |_| Command::Skip { by: -SKIP });
            to(Retained::into_super(center.changePlaybackPositionCommand()), position);
        }
        Remote { app: app.clone(), taken }
    }
}

impl Drop for Remote {
    fn drop(&mut self) {
        let taken = Taken(std::mem::take(&mut self.taken));
        let _ = self.app.run_on_main_thread(move || give_back(taken));
    }
}

// the commands given back, carried to the main thread, where alone they're touched
struct Taken(Vec<(Retained<MPRemoteCommand>, Retained<AnyObject>)>);
unsafe impl Send for Taken {}

fn give_back(Taken(taken): Taken) {
    for (command, target) in taken {
        unsafe { command.removeTarget(Some(&target)) };
    }
    let center = unsafe { MPNowPlayingInfoCenter::defaultCenter() };
    unsafe {
        center.setNowPlayingInfo(None);
        center.setPlaybackState(MPNowPlayingPlaybackState::Stopped);
    }
}

/// What the Mac is told of what's playing: 正在播放, told again only when what it shows changes, as macOS works out the
/// time from the rate and where it was told it was (IINA tells it so too).
#[derive(Default)]
pub struct Teller(Option<Told>);

// what was last told: the name, the length, whether the time runs, the seeks landed, and whether a file was open
#[derive(PartialEq)]
struct Told(String, Option<f64>, bool, u64, bool);

impl Teller {
    /// Tells it if anything it shows has changed: the name, the length, where it's at (after a seek, or as it stops or
    /// goes on), and whether the time runs, which it doesn't while it waits on the network, nor paused or done; macOS
    /// needs `playbackState` told on every start and stop to send the media keys here. While a version opens, its name
    /// alone; once one fails, nothing.
    pub fn tell(&mut self, app: &AppHandle, s: &State) {
        let runs = !s.paused && !s.ended && !s.waiting;
        let told = Told(s.title.clone(), s.duration, runs, s.seeks, s.position.is_some());
        if self.0.as_ref() == Some(&told) {
            return;
        }
        self.0 = Some(told);
        let (title, duration, position, failed) = (s.title.clone(), s.duration, s.position, s.failed.is_some());
        let on_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            // not after the player has closed, and given 正在播放 back
            if on_main.state::<Player>().0.lock().unwrap().is_none() {
                return;
            }
            let center = unsafe { MPNowPlayingInfoCenter::defaultCenter() };
            if failed {
                unsafe {
                    center.setNowPlayingInfo(None);
                    center.setPlaybackState(MPNowPlayingPlaybackState::Stopped);
                }
                return;
            }
            let mut keys: Vec<&NSString> =
                unsafe { vec![MPMediaItemPropertyTitle, MPNowPlayingInfoPropertyPlaybackRate, MPNowPlayingInfoPropertyMediaType] };
            let mut values: Vec<Retained<AnyObject>> = vec![
                NSString::from_str(&title).into(),
                NSNumber::new_f64(if runs { 1.0 } else { 0.0 }).into(),
                NSNumber::new_usize(MPNowPlayingInfoMediaType::Video.0).into(),
            ];
            if let Some(position) = position {
                keys.push(unsafe { MPNowPlayingInfoPropertyElapsedPlaybackTime });
                values.push(NSNumber::new_f64(position as f64).into());
            }
            if let Some(duration) = duration {
                keys.push(unsafe { MPMediaItemPropertyPlaybackDuration });
                values.push(NSNumber::new_f64(duration).into());
            }
            let state = if runs { MPNowPlayingPlaybackState::Playing } else { MPNowPlayingPlaybackState::Paused };
            unsafe {
                center.setNowPlayingInfo(Some(&NSDictionary::from_retained_objects(&keys, &values)));
                center.setPlaybackState(state);
            }
        });
    }
}
