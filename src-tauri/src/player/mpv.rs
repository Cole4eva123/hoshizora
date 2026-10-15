//! libmpv, the part the player uses: its client API, to run mpv and hear from it, and its render API, which the
//! picture draws with (layer.rs). Linked from Homebrew's mpv (build.rs); the declarations are those of its headers in
//! /opt/homebrew/include/mpv (client.h, render.h, render_gl.h), client API 2.5.

use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::ptr::null;

#[repr(C)]
pub struct Handle {
    _private: [u8; 0],
}

#[repr(C)]
pub struct RenderContext {
    _private: [u8; 0],
}

// mpv_format: a property's value as nothing (only that it changed), a flag, a 64-bit integer, or a double
pub const NONE: c_int = 0;
pub const FLAG: c_int = 3;
pub const INT64: c_int = 4;
pub const DOUBLE: c_int = 5;

// mpv_event_id, of the events read here
const QUIET: c_int = 0;
const SHUTDOWN: c_int = 1;
const LOG_MESSAGE: c_int = 2;
const START_FILE: c_int = 6;
const END_FILE: c_int = 7;
const PLAYBACK_RESTART: c_int = 21;
const PROPERTY_CHANGE: c_int = 22;
const HOOK: c_int = 25;
// mpv_end_file_reason: the file couldn't be opened, or playing it failed
const END_FILE_ERROR: c_int = 4;

#[repr(C)]
struct RawEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct EventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct EventHook {
    name: *const c_char,
    id: u64,
}

// the start of mpv_event_end_file; the playlist ids after it aren't read
#[repr(C)]
struct EventEndFile {
    reason: c_int,
    error: c_int,
}

#[repr(C)]
struct LogMessage {
    prefix: *const c_char,
    level: *const c_char,
    text: *const c_char,
}

// The render API's parameters, a list ended by one of kind 0.
#[repr(C)]
pub struct RenderParam {
    pub kind: c_int,
    pub data: *mut c_void,
}
pub const RENDER_PARAM_END: c_int = 0;
pub const RENDER_PARAM_API_TYPE: c_int = 1;
pub const RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
pub const RENDER_PARAM_OPENGL_FBO: c_int = 3;
pub const RENDER_PARAM_FLIP_Y: c_int = 4;
pub const RENDER_PARAM_DEPTH: c_int = 5;
pub const RENDER_PARAM_ADVANCED_CONTROL: c_int = 10;
pub const RENDER_PARAM_SKIP_RENDERING: c_int = 13;
// mpv_render_context_update's flag for a frame to draw
pub const RENDER_UPDATE_FRAME: u64 = 1;

#[repr(C)]
pub struct OpenGlInitParams {
    pub get_proc_address: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    pub get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
pub struct OpenGlFbo {
    pub fbo: c_int,
    pub w: c_int,
    pub h: c_int,
    pub internal_format: c_int,
}

#[link(name = "mpv")]
unsafe extern "C" {
    fn mpv_create() -> *mut Handle;
    fn mpv_initialize(ctx: *mut Handle) -> c_int;
    fn mpv_terminate_destroy(ctx: *mut Handle);
    fn mpv_set_option_string(ctx: *mut Handle, name: *const c_char, data: *const c_char) -> c_int;
    fn mpv_command(ctx: *mut Handle, args: *mut *const c_char) -> c_int;
    fn mpv_set_property(ctx: *mut Handle, name: *const c_char, format: c_int, data: *mut c_void) -> c_int;
    fn mpv_get_property(ctx: *mut Handle, name: *const c_char, format: c_int, data: *mut c_void) -> c_int;
    fn mpv_get_property_string(ctx: *mut Handle, name: *const c_char) -> *mut c_char;
    fn mpv_free(data: *mut c_void);
    fn mpv_observe_property(ctx: *mut Handle, userdata: u64, name: *const c_char, format: c_int) -> c_int;
    fn mpv_hook_add(ctx: *mut Handle, reply_userdata: u64, name: *const c_char, priority: c_int) -> c_int;
    fn mpv_hook_continue(ctx: *mut Handle, id: u64) -> c_int;
    fn mpv_request_log_messages(ctx: *mut Handle, min_level: *const c_char) -> c_int;
    fn mpv_wait_event(ctx: *mut Handle, timeout: f64) -> *mut RawEvent;
    fn mpv_error_string(error: c_int) -> *const c_char;
    pub fn mpv_render_context_create(res: *mut *mut RenderContext, mpv: *mut Handle, params: *mut RenderParam) -> c_int;
    pub fn mpv_render_context_set_update_callback(
        ctx: *mut RenderContext,
        callback: Option<unsafe extern "C" fn(*mut c_void)>,
        callback_ctx: *mut c_void,
    );
    pub fn mpv_render_context_update(ctx: *mut RenderContext) -> u64;
    pub fn mpv_render_context_render(ctx: *mut RenderContext, params: *mut RenderParam) -> c_int;
    pub fn mpv_render_context_free(ctx: *mut RenderContext);
}

/// An mpv instance, started. Anything may be asked of it from any thread, but only one thread waits for its events
/// (`next`); the core goes with it, so it's shared (`Arc`) with the thread that waits, and goes when that one's done.
pub struct Mpv(*mut Handle);

// libmpv's client API is thread-safe, but for mpv_wait_event, which only the event thread calls
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

/// What mpv tells, of what the player reads.
pub enum Event {
    /// nothing more, for now
    Quiet,
    Shutdown,
    Log(String),
    StartFile,
    /// the file couldn't be opened or played on: why, in mpv's words
    Failed(String),
    PlaybackRestart,
    /// a property observed changed: the id it was observed with, and its value
    Property(u64, Value),
    /// mpv waiting at the hook asked for (`hook`), till `proceed` with this id
    Hook(u64),
    Other,
}

/// A property's value, in the format it was observed in; `None` while it has none (no file).
pub enum Value {
    None,
    Flag(bool),
    Int(i64),
    Double(f64),
}

impl Value {
    pub fn flag(&self) -> bool {
        matches!(self, Value::Flag(true))
    }

    pub fn int(&self) -> Option<i64> {
        if let Value::Int(n) = self { Some(*n) } else { None }
    }

    pub fn double(&self) -> Option<f64> {
        if let Value::Double(n) = self { Some(*n) } else { None }
    }
}

impl Mpv {
    /// An instance with these options, started.
    pub fn new(options: &[(&str, &str)]) -> Result<Mpv, String> {
        let handle = unsafe { mpv_create() };
        if handle.is_null() {
            return Err("mpv_create failed".into());
        }
        let mpv = Mpv(handle);
        for (name, value) in options {
            check(unsafe { mpv_set_option_string(mpv.0, text(name).as_ptr(), text(value).as_ptr()) })
                .map_err(|e| format!("{name}: {e}"))?;
        }
        // its warnings and errors, on the app's stderr
        check(unsafe { mpv_request_log_messages(mpv.0, c"warn".as_ptr()) })?;
        check(unsafe { mpv_initialize(mpv.0) })?;
        Ok(mpv)
    }

    pub fn handle(&self) -> *mut Handle {
        self.0
    }

    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        let args: Vec<CString> = args.iter().map(|a| text(a)).collect();
        let mut args: Vec<*const c_char> = args.iter().map(|a| a.as_ptr()).chain([null()]).collect();
        check(unsafe { mpv_command(self.0, args.as_mut_ptr()) })
    }

    pub fn set_flag(&self, name: &str, value: bool) -> Result<(), String> {
        let mut value = c_int::from(value);
        check(unsafe { mpv_set_property(self.0, text(name).as_ptr(), FLAG, (&raw mut value).cast()) })
    }

    pub fn flag(&self, name: &str) -> Result<bool, String> {
        let mut value: c_int = 0;
        check(unsafe { mpv_get_property(self.0, text(name).as_ptr(), FLAG, (&raw mut value).cast()) })?;
        Ok(value != 0)
    }

    pub fn string(&self, name: &str) -> Option<String> {
        let value = unsafe { mpv_get_property_string(self.0, text(name).as_ptr()) };
        if value.is_null() {
            return None;
        }
        let read = unsafe { CStr::from_ptr(value) }.to_string_lossy().into_owned();
        unsafe { mpv_free(value.cast()) };
        Some(read)
    }

    pub fn set_double(&self, name: &str, mut value: f64) -> Result<(), String> {
        check(unsafe { mpv_set_property(self.0, text(name).as_ptr(), DOUBLE, (&raw mut value).cast()) })
    }

    /// Tells of the property's changes from now on, as `Event::Property` with `id`, in `format`.
    pub fn observe(&self, id: u64, name: &str, format: c_int) -> Result<(), String> {
        check(unsafe { mpv_observe_property(self.0, id, text(name).as_ptr(), format) })
    }

    /// Has mpv wait at one of its hooks (its manual's "Hooks"), each time till `proceed` is called with its id.
    pub fn hook(&self, name: &str) -> Result<(), String> {
        check(unsafe { mpv_hook_add(self.0, 0, text(name).as_ptr(), 0) })
    }

    pub fn proceed(&self, hook: u64) -> Result<(), String> {
        check(unsafe { mpv_hook_continue(self.0, hook) })
    }

    /// The next event, waiting for it as long as `timeout` (seconds; forever when negative). Only the event thread
    /// calls this.
    pub fn next(&self, timeout: f64) -> Event {
        // valid till the next mpv_wait_event, so everything is copied out of it
        let event = unsafe { &*mpv_wait_event(self.0, timeout) };
        unsafe {
            match event.event_id {
                QUIET => Event::Quiet,
                SHUTDOWN => Event::Shutdown,
                LOG_MESSAGE => {
                    let m = &*(event.data as *const LogMessage);
                    let [level, prefix, line] = [m.level, m.prefix, m.text].map(|s| CStr::from_ptr(s).to_string_lossy());
                    Event::Log(format!("{level} {prefix}: {line}"))
                }
                START_FILE => Event::StartFile,
                END_FILE => {
                    let end = &*(event.data as *const EventEndFile);
                    if end.reason == END_FILE_ERROR { Event::Failed(error_text(end.error)) } else { Event::Other }
                }
                PLAYBACK_RESTART => Event::PlaybackRestart,
                HOOK => Event::Hook((*(event.data as *const EventHook)).id),
                PROPERTY_CHANGE => {
                    let p = &*(event.data as *const EventProperty);
                    let value = match p.format {
                        FLAG => Value::Flag(*(p.data as *const c_int) != 0),
                        INT64 => Value::Int(*(p.data as *const i64)),
                        DOUBLE => Value::Double(*(p.data as *const f64)),
                        _ => Value::None,
                    };
                    Event::Property(event.reply_userdata, value)
                }
                _ => Event::Other,
            }
        }
    }
}

impl Drop for Mpv {
    fn drop(&mut self) {
        unsafe { mpv_terminate_destroy(self.0) }
    }
}

// A string as C takes it; one with a NUL in it (none of the player's) goes as an empty one, which mpv turns down.
fn text(s: &str) -> CString {
    CString::new(s).unwrap_or_default()
}

fn check(code: c_int) -> Result<(), String> {
    if code >= 0 { Ok(()) } else { Err(error_text(code)) }
}

fn error_text(code: c_int) -> String {
    unsafe { CStr::from_ptr(mpv_error_string(code)) }.to_string_lossy().into_owned()
}
