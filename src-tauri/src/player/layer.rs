//! The picture: mpv draws into an OpenGL layer under the window's web view, which is see-through, so the page's
//! controls float over the video. Drawn as IINA's ViewLayer draws (github.com/iina/iina, iina/ViewLayer.swift): on a
//! thread of its own whenever mpv has a frame, and never on the main thread, which drawing would hold up while mpv
//! waits out a frame's time. Core Animation's own asks there (the window resized, or shown) go to that thread too.

// OpenGL, and CAOpenGLLayer with it, is deprecated on macOS, but works, and is what libmpv's render API and IINA draw
// with
#![allow(deprecated)]

use std::ffi::{c_char, c_int, c_void};
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;

use objc2::rc::{Allocated, Retained};
use objc2::{AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow, NSWindowOrderingMode};
use objc2_foundation::NSObject;
use objc2_quartz_core::{CALayer, CAOpenGLLayer, CATransaction, kCAGravityResizeAspectFill};

use super::mpv::{self, Mpv, RenderParam};

type PixelFormat = *mut c_void;
type Context = *mut c_void;

#[link(name = "OpenGL", kind = "framework")]
unsafe extern "C" {
    fn CGLChoosePixelFormat(attributes: *const c_int, format: *mut PixelFormat, count: *mut c_int) -> c_int;
    fn CGLCreateContext(format: PixelFormat, share: Context, context: *mut Context) -> c_int;
    fn CGLRetainPixelFormat(format: PixelFormat) -> PixelFormat;
    fn CGLRetainContext(context: Context) -> Context;
    fn CGLReleasePixelFormat(format: PixelFormat);
    fn CGLReleaseContext(context: Context);
    fn CGLSetCurrentContext(context: Context) -> c_int;
    fn CGLLockContext(context: Context) -> c_int;
    fn CGLUnlockContext(context: Context) -> c_int;
    fn CGLSetParameter(context: Context, name: c_int, value: *const c_int) -> c_int;
    fn glGetIntegerv(name: u32, data: *mut c_int);
    fn glClearColor(red: f32, green: f32, blue: f32, alpha: f32);
    fn glClear(mask: u32);
    fn glFlush();
}

unsafe extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

// kCGLPFA… (CGLTypes.h): OpenGL 3.2's core profile, as libmpv built from source turns the legacy one down, on the GPU,
// double-buffered, and on whichever GPU the system switches to
const PROFILE: c_int = 99;
const CORE_3_2: c_int = 0x3200;
const ACCELERATED: c_int = 73;
const DOUBLE_BUFFER: c_int = 5;
const ALLOW_OFFLINE_RENDERERS: c_int = 96;
const AUTOMATIC_GRAPHICS_SWITCHING: c_int = 101;
// kCGLCPSwapInterval: drawn in step with the screen
const SWAP_INTERVAL: c_int = 222;
// gl3.h
const COLOR_BUFFER_BIT: u32 = 0x4000;
const DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
const VIEWPORT: u32 = 0x0BA2;
// dlfcn.h: every image loaded, OpenGL.framework among them
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

// What the layer and its drawing thread share; also what mpv's update callback is handed, so it lives as long as the
// layer, which outlives the renderer.
struct Gl {
    format: PixelFormat,
    context: Context,
    // mpv's renderer for the layer's context, null till made and once freed
    render: AtomicPtr<mpv::RenderContext>,
    // the drawing thread is drawing for mpv, and the layer hasn't drawn yet
    flip: AtomicBool,
    // the frame there is drawn again however mpv answers, at the layer's new size
    force: AtomicBool,
    wake: Mutex<Wake>,
    woken: Condvar,
}

// The drawing thread's to-do: something to draw, or time to stop.
#[derive(Default)]
struct Wake {
    draw: bool,
    stop: bool,
}

// CGL's pixel format and context are used from any thread, the context locked (`with_context`)
unsafe impl Send for Gl {}
unsafe impl Sync for Gl {}

impl Gl {
    fn new() -> Result<Gl, String> {
        let attributes =
            [PROFILE, CORE_3_2, ACCELERATED, DOUBLE_BUFFER, ALLOW_OFFLINE_RENDERERS, AUTOMATIC_GRAPHICS_SWITCHING, 0];
        let (mut format, mut count) = (null_mut(), 0);
        unsafe { CGLChoosePixelFormat(attributes.as_ptr(), &mut format, &mut count) };
        if format.is_null() {
            return Err("no OpenGL 3.2 pixel format".into());
        }
        let mut context = null_mut();
        unsafe { CGLCreateContext(format, null_mut(), &mut context) };
        if context.is_null() {
            return Err("no OpenGL context".into());
        }
        unsafe { CGLSetParameter(context, SWAP_INTERVAL, &1) };
        let (render, flip, force) = (AtomicPtr::default(), AtomicBool::default(), AtomicBool::default());
        Ok(Gl { format, context, render, flip, force, wake: Mutex::default(), woken: Condvar::new() })
    }

    // Has the drawing thread draw: mpv's next frame, or with `force` set first, the one there again.
    fn wake(&self) {
        self.wake.lock().unwrap().draw = true;
        self.woken.notify_one();
    }

    // Runs `f` with the layer's context locked and current here, as libmpv's render calls need it outside the layer's
    // own drawing.
    fn with_context<T>(&self, f: impl FnOnce() -> T) -> T {
        unsafe {
            CGLLockContext(self.context);
            CGLSetCurrentContext(self.context);
        }
        let done = f();
        unsafe { CGLUnlockContext(self.context) };
        done
    }

    // Takes mpv's frame without drawing it, as mpv waits for the frame to be taken (ADVANCED_CONTROL).
    fn skip(&self) {
        let render = self.render.load(Ordering::Acquire);
        if render.is_null() {
            return;
        }
        self.with_context(|| unsafe {
            if mpv::mpv_render_context_update(render) & mpv::RENDER_UPDATE_FRAME != 0 {
                let mut skip: c_int = 1;
                let mut params = [param(mpv::RENDER_PARAM_SKIP_RENDERING, &mut skip), end()];
                mpv::mpv_render_context_render(render, params.as_mut_ptr());
            }
        });
    }
}

// once the layer and the picture are both done with it
impl Drop for Gl {
    fn drop(&mut self) {
        unsafe {
            CGLReleaseContext(self.context);
            CGLReleasePixelFormat(self.format);
        }
    }
}

fn param<T>(kind: c_int, data: &mut T) -> RenderParam {
    RenderParam { kind, data: (data as *mut T).cast() }
}

fn end() -> RenderParam {
    RenderParam { kind: mpv::RENDER_PARAM_END, data: null_mut() }
}

// mpv has a frame, or work for its renderer: the drawing thread takes it. Nothing of mpv's may be called here.
unsafe extern "C" fn on_update(gl: *mut c_void) {
    unsafe { &*(gl as *const Gl) }.wake();
}

// Where libmpv finds OpenGL's functions: among those linked, as CGLGetProcAddress misses the core profile's.
unsafe extern "C" fn proc_address(_: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe { dlsym(RTLD_DEFAULT, name) }
}

define_class!(
    // SAFETY: CAOpenGLLayer asks nothing of a subclass but the methods it overrides, which keep their types; there's
    // no Drop.
    #[unsafe(super(CAOpenGLLayer, CALayer, NSObject))]
    #[name = "HoshizoraVideoLayer"]
    #[ivars = Arc<Gl>]
    struct VideoLayer;

    impl VideoLayer {
        // Core Animation's copies of the layer (its presentation) draw with the same context and renderer.
        #[unsafe(method_id(initWithLayer:))]
        fn init_with_layer(this: Allocated<Self>, layer: &VideoLayer) -> Retained<Self> {
            let this = this.set_ivars(layer.ivars().clone());
            unsafe { msg_send![super(this), initWithLayer: layer] }
        }

        #[unsafe(method(copyCGLPixelFormatForDisplayMask:))]
        fn copy_pixel_format(&self, _mask: u32) -> PixelFormat {
            unsafe { CGLRetainPixelFormat(self.ivars().format) }
        }

        #[unsafe(method(copyCGLContextForPixelFormat:))]
        fn copy_context(&self, _format: PixelFormat) -> Context {
            unsafe { CGLRetainContext(self.ivars().context) }
        }

        // Whether there's a frame to draw: mpv's next one, or the one there again at a new size. mpv is asked even
        // then, as it's to be asked after each update callback.
        #[unsafe(method(canDrawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn can_draw(&self, context: Context, _format: PixelFormat, _time: f64, _at: *const c_void) -> bool {
            let gl = self.ivars();
            let render = gl.render.load(Ordering::Acquire);
            // current here, as the update may draw (ADVANCED_CONTROL's queued work)
            let frame = !render.is_null()
                && unsafe {
                    CGLSetCurrentContext(context);
                    mpv::mpv_render_context_update(render)
                } & mpv::RENDER_UPDATE_FRAME
                    != 0;
            gl.force.swap(false, Ordering::Relaxed) || frame
        }

        // Draws mpv's frame into the layer, flipped, as OpenGL counts rows from the bottom; black till mpv has one.
        #[unsafe(method(drawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn draw(&self, _context: Context, _format: PixelFormat, _time: f64, _at: *const c_void) {
            let gl = self.ivars();
            gl.flip.store(false, Ordering::Relaxed);
            let render = gl.render.load(Ordering::Acquire);
            unsafe {
                if render.is_null() {
                    glClearColor(0.0, 0.0, 0.0, 1.0);
                    glClear(COLOR_BUFFER_BIT);
                } else {
                    let (mut fbo, mut viewport) = (0, [0; 4]);
                    glGetIntegerv(DRAW_FRAMEBUFFER_BINDING, &mut fbo);
                    glGetIntegerv(VIEWPORT, viewport.as_mut_ptr());
                    let mut target = mpv::OpenGlFbo { fbo, w: viewport[2], h: viewport[3], internal_format: 0 };
                    let mut flip: c_int = 1;
                    let mut params = [
                        param(mpv::RENDER_PARAM_OPENGL_FBO, &mut target),
                        param(mpv::RENDER_PARAM_FLIP_Y, &mut flip),
                        end(),
                    ];
                    mpv::mpv_render_context_render(render, params.as_mut_ptr());
                }
                glFlush();
            }
        }

        // (named apart from CALayer's `display`, which the drawing thread calls to reach it)
        #[unsafe(method(display))]
        fn display_here(&self) {
            if MainThreadMarker::new().is_some() {
                let gl = self.ivars();
                gl.force.store(true, Ordering::Relaxed);
                gl.wake();
                return;
            }
            // an explicit transaction, as there's no implicit one off the main thread; flushed, as one made inside
            // another (a resize's) shows only once that one is
            CATransaction::begin();
            let _: () = unsafe { msg_send![super(self), display] };
            CATransaction::commit();
            CATransaction::flush();
        }
    }
);

impl VideoLayer {
    fn new(gl: Arc<Gl>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(gl);
        unsafe { msg_send![super(this), init] }
    }
}

// The drawing thread: draws whenever woken, till told to stop.
fn draw_all(Shared(layer): Shared) {
    let gl = layer.ivars().clone();
    loop {
        {
            let mut wake = gl.wake.lock().unwrap();
            while !wake.draw && !wake.stop {
                wake = gl.woken.wait(wake).unwrap();
            }
            if wake.stop {
                return;
            }
            wake.draw = false;
        }
        gl.flip.store(true, Ordering::Relaxed);
        layer.display();
        // Core Animation didn't draw: the window is hidden, or on another Space
        if gl.flip.swap(false, Ordering::Relaxed) {
            gl.skip();
        }
    }
}

// The layer, for the drawing thread, which only displays it, as Core Animation lets any thread do in a transaction.
struct Shared(Retained<VideoLayer>);
unsafe impl Send for Shared {}

/// The picture in the player's window, which mpv draws into: a layer under the web view, and the thread drawing it.
pub struct Picture {
    layer: Retained<VideoLayer>,
    thread: Option<JoinHandle<()>>,
}

// Its layer is only displayed off the main thread, or rescaled on it; its renderer is freed with the context locked.
unsafe impl Send for Picture {}

impl Picture {
    /// Puts the picture under the web view of `window`, and has mpv draw into it from now on.
    pub fn new(mtm: MainThreadMarker, window: &NSWindow, mpv: &Mpv) -> Result<Picture, String> {
        let gl = Arc::new(Gl::new()?);
        let layer = VideoLayer::new(gl.clone());
        layer.setOpaque(true);
        // while a resize waits for its frame, the one there is scaled up without being squashed
        layer.setContentsGravity(unsafe { kCAGravityResizeAspectFill });
        layer.setNeedsDisplayOnBoundsChange(true);
        layer.setContentsScale(window.backingScaleFactor());
        let content = window.contentView().ok_or("the window has no content view")?;
        let view = NSView::initWithFrame(NSView::alloc(mtm), content.bounds());
        // hosting the layer, which is set before the view wants one, as IINA's VideoView does
        view.setLayer(Some(&layer));
        view.setWantsLayer(true);
        view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
        content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);

        let mut render = null_mut();
        let made = gl.with_context(|| unsafe {
            let mut init = mpv::OpenGlInitParams { get_proc_address: proc_address, get_proc_address_ctx: null_mut() };
            let mut advanced: c_int = 1;
            let mut params = [
                RenderParam { kind: mpv::RENDER_PARAM_API_TYPE, data: c"opengl".as_ptr().cast_mut().cast() },
                param(mpv::RENDER_PARAM_OPENGL_INIT_PARAMS, &mut init),
                // direct rendering, decoding into the GPU's memory; the drawing thread never waits for mpv's core
                param(mpv::RENDER_PARAM_ADVANCED_CONTROL, &mut advanced),
                end(),
            ];
            mpv::mpv_render_context_create(&mut render, mpv.handle(), params.as_mut_ptr())
        });
        if made < 0 || render.is_null() {
            return Err(format!("mpv's renderer: {made}"));
        }
        gl.render.store(render, Ordering::Release);
        unsafe { mpv::mpv_render_context_set_update_callback(render, Some(on_update), Arc::as_ptr(&gl).cast_mut().cast()) };

        let shared = Shared(layer.clone());
        let thread = std::thread::Builder::new()
            .name("picture".into())
            .spawn(move || draw_all(shared))
            .map_err(|e| e.to_string())?;
        Ok(Picture { layer, thread: Some(thread) })
    }

    /// The window is on a screen of another scale now: the picture is drawn at its resolution.
    pub fn rescale(&self, scale: f64) {
        self.layer.setContentsScale(scale);
        let gl = self.layer.ivars();
        gl.force.store(true, Ordering::Relaxed);
        gl.wake();
    }
}

impl Drop for Picture {
    // The renderer goes before mpv's core does, as libmpv asks, once nothing draws with it.
    fn drop(&mut self) {
        let gl = self.layer.ivars();
        gl.wake.lock().unwrap().stop = true;
        gl.woken.notify_one();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let render = gl.render.swap(null_mut(), Ordering::AcqRel);
        if !render.is_null() {
            gl.with_context(|| unsafe {
                mpv::mpv_render_context_set_update_callback(render, None, null_mut());
                mpv::mpv_render_context_free(render);
            });
        }
    }
}
