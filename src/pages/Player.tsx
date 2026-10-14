import { type MouseEvent, type RefObject, type WheelEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { type Resource, convertFileSrc } from '@tauri-apps/api/core'
import { LogicalPosition } from '@tauri-apps/api/dpi'
import { CheckMenuItem, Menu, type MenuOptions } from '@tauri-apps/api/menu'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { type Translate, localeOf, useT } from '@/lib/i18n'
import { type PlayerState, type PlayerTrack, clockOf, command, speakerOf, usePlayer } from '@/lib/player'
import { asideOf, audioLabel, noTrack, subtitleLabel, subtitlesOf } from '@/lib/tracks'
import { cn } from '@/lib/utils'

// IINA's habits: the controls leave once the pointer has rested 2.5 s; a key's seek is 5 s, its volume step 5; the
// controls' ◀◀ ▶▶ skip 10 s, as the Mac's own controls do (now.rs `SKIP`)
const idle = 2500
const step = { seek: 5, volume: 5, skip: 10 }
// a trackpad's scroll, in pixels, for one step of volume and for a second of seeking: a flick runs to hundreds, its
// momentum included, so a flick is some steps, not all of them
// ponytail: tuned by feel on one trackpad; a mouse wheel's notches may want their own
const scrollPerStep = { volume: 25, seek: 15 }
// a pointer moved this far with its button down drags the window
const dragAfter = 4
// the room over the controls the scrubber's time takes as the pointer rests on it, which the 字幕 keep clear of
const hintRoom = 24
// the controls' symbols, in points: play and pause, the skips, the speaker (IINA's 13) and the tools (IINA's 14, medium)
const sizes = { play: 20, skip: 15, speaker: 13, tool: 14 }
// the ones that come and go with what's playing, asked for as the page opens, so a first toggle needn't wait on a drawing
const toggled: [name: string, size: number, medium?: boolean][] = [
  ['play.fill', sizes.play],
  ['pause.fill', sizes.play],
  ...['slash', 'wave.1', 'wave.2', 'wave.3'].map((s): [string, number] => [`speaker.${s}.fill`, sizes.speaker]),
  ['speaker.fill', sizes.speaker],
  ['arrow.up.left.and.arrow.down.right', sizes.tool, true],
  ['arrow.down.right.and.arrow.up.left', sizes.tool, true],
]
// a native menu's measure on macOS 26 (an NSMenu's size, measured): each row, the line between its parts, and the room
// above and below, so the 字幕 menu can open upward from the controls, as QuickTime's does
// ponytail: another macOS's menu may sit a few points off; NSMenu's own size, through a command, if one does
const menuRow = 24
const menuLine = 11
const menuRoom = 10

const clamp = (v: number, least: number, most: number) => Math.min(Math.max(v, least), most)
const volumeText = (volume: number, t: Translate) => t(`音量 ${Math.round(volume)}`, `Volume ${Math.round(volume)}`)
// how late the subtitles are put, a tenth of a second at a time (Shift and ← →, as IINA's)
const delayStep = 0.1
// the track of a kind playing, and what the corner says as another is put on: its kind and its name, or 关闭
const playingOf = (tracks: PlayerTrack[]) => tracks.find((x) => x.selected)
const offText = (t: Translate) => t('关闭', 'Off')
const trackText = (t: Translate, kind: string, name = offText(t)) => t(`${kind}：${name}`, `${kind}: ${name}`)
const delayText = (delay: number, t: Translate) => {
  // signed but for none, and none of what mpv's float sums of the steps leave (2.8e-17 is 0.0)
  const d = new Intl.NumberFormat(localeOf(t), { signDisplay: 'exceptZero', minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return t(`字幕延迟 ${d.format(delay)} 秒`, `Subtitle delay ${d.format(delay)} s`)
}
// a 字幕 in a line, as the menu, the corner and the bubble's label name it: what its title adds beside its name, as two
// of a language may differ only there
const subtitleText = (x: PlayerTrack, t: Translate) => {
  const [name, aside] = [subtitleLabel(x, t), asideOf(x, t)]
  return aside ? t(`${name}（${aside}）`, `${name} (${aside})`) : name
}

// The Mac's glass, as IINA's controls, messages and waits are on macOS 26, in white and black (--shine, --film) rather
// than the app's night and starlight (the user's call: native first). An NSGlassEffectView put under the web view leaves the page unseen,
// and CSS can't bend the light at the rim, so this is a frost with a lit edge, halving the film's light as that glass
// does (measured over the same colours), and faintly grey over black; backdrop-filter reaches the film under the page.
const glass =
  'bg-shine/5 shadow-glass backdrop-blur-lg backdrop-brightness-50 backdrop-saturate-150'

// The player's page, over the video (src-tauri/src/player), as IINA's window is on macOS 26: the film alone till the
// pointer moves; then the controls on glass at the foot, and the window's title bar frosted at the top; all of it, the
// cursor and the window's buttons go once the pointer rests. Its clicks too: one hides them (moving shows them), a
// double click goes full screen, a right click pauses; scrolling up and down sets the volume, sideways seeks; and the
// keys are IINA's.
export default function Player() {
  const t = useT()
  const s = usePlayer()
  useEffect(() => {
    document.documentElement.lang = localeOf(t) // as the main window's, for screen readers and the glyphs
  }, [t])
  const [awake, setAwake] = useState(true)
  const [over, setOver] = useState(false)
  // a native menu up, through which the page hears nothing: the controls stay, and rest from when it's put away
  const [menu, setMenu] = useState(false)
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined)
  const wake = () => {
    setAwake(true)
    clearTimeout(rest.current)
    rest.current = setTimeout(() => setAwake(false), idle)
  }
  // and once it's put away, where the pointer is isn't known till it moves (it may have left the controls to pick), so
  // they rest from then, the pointer on them again at its first move
  const onMenu = (up: boolean) => {
    setMenu(up)
    if (up) return
    setOver(false)
    wake()
  }
  // from the moment the window opens, so a film started and left alone shows nothing over it
  useEffect(() => {
    rest.current = setTimeout(() => setAwake(false), idle)
    return () => clearTimeout(rest.current)
  }, [])
  useEffect(() => {
    for (const [name, size, medium] of toggled) new Image().srcset = symbolOf(name, size, medium)
  }, [])
  // held while paused, at the end, opening or failed, and while the pointer is on them
  const shown = awake || over || menu || !s || s.paused || s.ended || !!s.failed || s.position === undefined
  const opening = s !== undefined && !s.failed && s.position === undefined
  const fullscreen = !!s?.fullscreen
  // and off them once they can't be pointed at (a version opening, or failed), where no leaving is heard
  if (over && (opening || s?.failed)) setOver(false)
  useEffect(() => {
    // and on going full screen or back, as its title bar is then macOS's (player::chrome)
    command({ kind: 'chrome', shown })
  }, [shown, fullscreen])
  // The 字幕 stand clear of the controls while they show, as a Mac's own player has them (IINA leaves them under):
  // measured once the player first answers, as nothing is drawn before, and again as the window changes size.
  const controls = useRef<HTMLDivElement>(null)
  const answered = s !== undefined
  useEffect(() => {
    const lift = () => {
      // and clear of the time named just over them as the pointer rests on the scrubber (`Track`'s hint)
      const top = (controls.current?.getBoundingClientRect().top ?? innerHeight) - hintRoom
      command({ kind: 'subPos', pos: shown ? (top / innerHeight) * 100 : 100 })
    }
    lift()
    if (!shown) return
    addEventListener('resize', lift)
    return () => removeEventListener('resize', lift)
  }, [shown, answered])

  // A corner message, IINA's OSD: what changed, for a second, whoever changed it (a key, a click, a scroll, the media
  // keys), told as mpv tells it, so a press faster than its answer never shows a guess. Not while a version opens.
  const [said, setSaid] = useState<{ text: string; n: number }>()
  const was = useRef(s)
  useEffect(() => {
    const before = was.current
    was.current = s
    if (!s || before?.position === undefined || s.position === undefined) return
    // the end pauses it too (keep-open), which nobody asked; a volume step that unmutes tells the volume
    const [audio, subtitle] = [playingOf(s.audio), playingOf(s.subtitles)]
    const text =
      s.ended !== before.ended
        ? undefined
        : s.paused !== before.paused
          ? s.paused
            ? t('暂停', 'Pause')
            : t('播放', 'Play')
          : s.volume !== before.volume
            ? volumeText(s.volume, t)
            : s.muted !== before.muted
              ? s.muted
                ? t('静音', 'Muted')
                : t('取消静音', 'Sound on')
              : s.seeks !== before.seeks
                ? clockOf(s.position)
                : s.subDelay !== before.subDelay
                  ? delayText(s.subDelay, t)
                  : audio?.id !== playingOf(before.audio)?.id
                    ? trackText(t, t('音频', 'Audio'), audio && audioLabel(audio, t))
                    : subtitle?.id !== playingOf(before.subtitles)?.id
                      ? trackText(t, t('字幕', 'Subtitles'), subtitle && subtitleText(subtitle, t))
                      : undefined
    if (text) setSaid((last) => ({ text, n: (last?.n ?? 0) + 1 }))
  }, [s, t])

  // What the keys, clicks and scrolls ask, relative or toggled where it can be, so mpv (or the window) works it out
  // from where it really is, and presses faster than its answers add up.
  // at the end it starts over (player's togglePause)
  const toggle = () => command({ kind: 'togglePause' })
  const toggleFullscreen = () => command({ kind: 'toggleFullscreen' })

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    // the menu's shortcuts (⌘W), and a button's Enter and Space when the keyboard has put the focus there (a click
    // doesn't: `Button`); arrows are the page's on a slider too, so a skip is 5 s wherever the focus is
    const pressing = e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')
    if (e.metaKey || e.ctrlKey || e.altKey || pressing || !s) return
    // no seeking while a version opens, which would take the place of where it picks up, nor a delay for it
    if ((opening || s.failed) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
    // with a 字幕 on, as there's nothing else to put later or sooner (without, Shift and an arrow skips, as an arrow does)
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && playingOf(s.subtitles)) {
      e.preventDefault()
      command({ kind: 'subDelay', by: e.key === 'ArrowLeft' ? -delayStep : delayStep })
      return
    }
    const keys: Record<string, () => void> = {
      ' ': toggle,
      ArrowLeft: () => command({ kind: 'skip', by: -step.seek }),
      ArrowRight: () => command({ kind: 'skip', by: step.seek }),
      ArrowUp: () => command({ kind: 'addVolume', by: step.volume }),
      ArrowDown: () => command({ kind: 'addVolume', by: -step.volume }),
      f: toggleFullscreen,
      Enter: toggleFullscreen,
      Escape: () => command({ kind: 'fullscreen', on: false }),
      m: () => command({ kind: 'toggleMute' }),
    }
    const key = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (!key) return
    e.preventDefault()
    // a key held down repeats a seek or a volume step, never a toggle
    if (!e.repeat || e.key.startsWith('Arrow')) key()
  })
  useEffect(() => {
    const keys = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [])

  // Scrolling: up and down a step of volume per so many pixels; sideways seconds of seeking, gathered while the fingers
  // move (the corner shows where they'd land) and sought once they stop, as each seek of a link asks the network again.
  const scrolled = useRef({ volume: 0, seek: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined })
  const scroll = (e: WheelEvent) => {
    // a pinch comes as a wheel with ctrl held, and isn't a scroll
    if (s?.position === undefined || e.ctrlKey) return
    const r = scrolled.current
    if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      r.volume -= e.deltaY / scrollPerStep.volume
      const by = Math.trunc(r.volume)
      if (by) {
        r.volume -= by
        command({ kind: 'addVolume', by })
      }
      return
    }
    r.seek += e.deltaX / scrollPerStep.seek
    setSaid((last) => ({ text: clockOf(clamp(s.position! + r.seek, 0, s.duration ?? Infinity)), n: (last?.n ?? 0) + 1 }))
    clearTimeout(r.timer)
    r.timer = setTimeout(() => {
      // a brush of less than half a second is no seek, as each asks the network again
      const by = Math.round(r.seek)
      if (by) command({ kind: 'skip', by })
      r.seek = 0
    }, 250)
  }
  // a seek still gathering isn't for the next version, nor for a window closing
  useEffect(() => {
    const r = scrolled.current
    if (opening) {
      clearTimeout(r.timer)
      r.seek = 0
    }
    return () => clearTimeout(r.timer)
  }, [opening])

  // A press on the picture that moves on drags the window, as the picture is the window's to hold.
  const pressed = useRef<{ x: number; y: number }>(undefined)

  if (!s) return null
  return (
    <main
      className={cn('fixed inset-0 select-none', !shown && 'cursor-none')}
      onPointerMove={(e) => {
        wake()
        const from = pressed.current
        if (from && e.buttons === 1 && Math.hypot(e.clientX - from.x, e.clientY - from.y) > dragAfter) {
          pressed.current = undefined
          void getCurrentWindow().startDragging()
        }
      }}
      // a press anywhere first forgets the last, whose release may have come off the page; the picture's then keeps it
      onPointerDownCapture={() => (pressed.current = undefined)}
      onPointerUp={() => (pressed.current = undefined)}
      onWheel={scroll}
      // never WebKit's menu (Reload would lose the page): a right click on the picture pauses, on the rest it's nothing,
      // as on IINA's controls
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* the picture, which takes the clicks the controls don't */}
      <div
        className="absolute inset-0"
        onPointerDown={(e) => (pressed.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : undefined)}
        onClick={() => setAwake(false)}
        onDoubleClick={toggleFullscreen}
        onContextMenu={(e) => {
          e.preventDefault()
          toggle()
        }}
      />

      {/* the window's title bar, frosted behind its buttons and title as IINA's is (an NSVisualEffectView, .titlebar) */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-7 bg-titlebar shadow-hairline backdrop-blur-xl transition-[opacity,visibility] duration-300',
          (!shown || fullscreen) && 'invisible opacity-0',
        )}
      />

      {said && (
        <p
          key={said.n}
          role="status"
          className={cn(
            'pointer-events-none absolute left-2 rounded-2xl px-4 py-2 text-xl text-shine tabular-nums animate-corner',
            glass,
            fullscreen ? 'top-2' : 'top-9',
          )}
        >
          {said.text}
        </p>
      )}

      {/* waiting on the network mid-film, after a moment, as a seek within what's loaded takes none */}
      {s.waiting && !opening && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {/* fading in itself, as glass inside something fading frosts nothing till it's done */}
          <Waiting label={t('正在缓冲…', 'Buffering…')} className="animate-appear opacity-0" />
        </div>
      )}

      {/* while a version opens (seconds on a cloud drive's link), over the last film's frame; it fades as this begins */}
      <div
        aria-hidden={!opening}
        className={cn(
          'pointer-events-none absolute inset-0 grid place-items-center bg-film transition-[opacity,visibility] duration-500',
          !opening && 'invisible opacity-0',
        )}
      >
        {/* fading with it, its spinner stilled once the film plays */}
        <Waiting
          label={s.title}
          detail={s.from ? t(`从 ${clockOf(s.from)} 继续`, `Picking up at ${clockOf(s.from)}`) : t('正在打开…', 'Opening…')}
          still={!opening}
        />
      </div>

      {s.failed && (
        // the picture's clicks and drags reach through, so the window still moves
        <div role="alert" className="pointer-events-none absolute inset-0 grid place-items-center bg-film px-8 text-center">
          <div className="flex flex-col items-center gap-2">
            <Icon name="exclamationmark.triangle.fill" size={28} className="opacity-60" />
            <p className="text-body font-semibold text-shine">{t('打不开这个片源', "Couldn't open this source")}</p>
            <p className="text-name text-shine/60">{s.failed}</p>
          </div>
        </div>
      )}

      {/* the controls, IINA's floating ones: 460 wide, a tenth of the window's height up from its foot */}
      <div
        ref={controls}
        // nor reached from the keyboard then: a skip would take the place of where a version picks up
        inert={opening || !!s.failed}
        onPointerMove={() => setOver(true)}
        onPointerLeave={() => setOver(false)}
        className={cn(
          'absolute bottom-[10%] left-1/2 w-[460px] max-w-[calc(100%-20px)] -translate-x-1/2 rounded-xl px-3 pt-3.5 pb-2 transition-[opacity,visibility] duration-300',
          glass,
          (!shown || opening || s.failed) && 'pointer-events-none invisible opacity-0',
        )}
      >
        <div className="flex h-6 items-center">
          <div className="flex flex-1 items-center gap-1 pl-1">
            <Button
              label={s.muted ? t('取消静音', 'Sound on') : t('静音', 'Mute')}
              icon={speakerOf(s)}
              size={sizes.speaker}
              // at its left, so the speaker itself stays put as its waves come and go
              className="justify-items-start"
              onClick={() => command({ kind: 'toggleMute' })}
            />
            <Track
              value={s.volume}
              max={100}
              step={1}
              label={t('音量', 'Volume')}
              text={(v) => volumeText(v, t)}
              round
              onInput={(volume) => command({ kind: 'volume', volume })}
              className={cn('w-[70px]', s.muted && 'opacity-50')}
            />
          </div>
          <div className="flex items-center gap-6">
            <Button
              label={t(`后退 ${step.skip} 秒`, `Back ${step.skip} Seconds`)}
              icon="backward.fill"
              size={sizes.skip}
              onClick={() => command({ kind: 'skip', by: -step.skip })}
            />
            <Button
              label={s.paused || s.ended ? t('播放', 'Play') : t('暂停', 'Pause')}
              icon={s.paused || s.ended ? 'play.fill' : 'pause.fill'}
              size={sizes.play}
              onClick={toggle}
            />
            <Button
              label={t(`前进 ${step.skip} 秒`, `Forward ${step.skip} Seconds`)}
              icon="forward.fill"
              size={sizes.skip}
              onClick={() => command({ kind: 'skip', by: step.skip })}
            />
          </div>
          <div className="flex flex-1 items-center justify-end">
            {/* only where there's a choice: two 音轨 or more, one 字幕 or more */}
            {!opening && (s.audio.length > 1 || s.subtitles.length > 0) && (
              <TrackMenu s={s} onMenu={onMenu} />
            )}
            <Button
              label={fullscreen ? t('退出全屏', 'Exit Full Screen') : t('全屏', 'Full Screen')}
              icon={fullscreen ? 'arrow.down.right.and.arrow.up.left' : 'arrow.up.left.and.arrow.down.right'}
              size={sizes.tool}
              medium
              onClick={toggleFullscreen}
            />
          </div>
        </div>
        <Scrubber s={s} over={controls} />
      </div>
    </main>
  )
}

// One of the Mac's own symbols (SF Symbols), drawn white by the player at `size` points, regular or `medium`
// (src-tauri/src/player/symbol.rs), at twice its size for the screen's two pixels to a point
const symbolOf = (name: string, size: number, medium?: boolean) =>
  `${convertFileSrc(name, 'symbol')}?size=${size}${medium ? '&weight=medium' : ''} 2x`
function Icon({ name, size, medium, className }: { name: string; size: number; medium?: boolean; className?: string }) {
  return <img alt="" srcSet={symbolOf(name, size, medium)} className={cn('pointer-events-none', className)} />
}

// A wait, as IINA's is: the system's spinner on glass, what it waits for (the 作品's name, as a full screen shows no
// title bar), and a detail under it; `still` once it's over, as it fades.
function Waiting({
  label,
  detail,
  still,
  className,
}: {
  label: string
  detail?: string
  still?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex w-[182px] flex-col items-center gap-1 rounded-2xl px-5 py-3 text-center', glass, className)}>
      <Spinner still={still} />
      <p className="text-name text-balance text-shine">{label}</p>
      {detail && <p className="text-detail text-shine/60 tabular-nums">{detail}</p>}
    </div>
  )
}

// NSProgressIndicator's spinner: twelve spokes fading round, stepping a spoke at a time, but `still`.
function Spinner({ still }: { still?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="-16 -16 32 32"
      className={cn('size-8 motion-safe:animate-[spin_1s_steps(12)_infinite]', still && '[animation-play-state:paused]')}
    >
      {Array.from({ length: 12 }, (_, i) => (
        <line
          key={i}
          y1="-7.5"
          y2="-13"
          transform={`rotate(${i * 30})`}
          strokeLinecap="round"
          strokeOpacity={(i + 1) / 12}
          className="stroke-shine stroke-[2.5]"
        />
      ))}
    </svg>
  )
}

// The scrubber: where the film's at between its two times, a dragged position shown till it's let go of and then
// sought, as each seek of a link asks the network again; and, under the pointer, the time it would seek to.
function Scrubber({ s, over }: { s: PlayerState; over: RefObject<HTMLElement | null> }) {
  const t = useT()
  const duration = s.duration ?? 0
  const at = s.position ?? 0
  // where it was let go of, shown till mpv is there (its seconds tick on meanwhile), or for 5 s if the seek came to
  // nothing, and never past the file (another version opening); and where the knob is held, which the clock follows
  const [sought, setSought] = useState<number>()
  const [held, setHeld] = useState<number>()
  if (sought !== undefined && (s.position === undefined || Math.abs(at - sought) < 2)) setSought(undefined)
  useEffect(() => {
    if (sought === undefined) return
    const gone = setTimeout(() => setSought(undefined), 5000)
    return () => clearTimeout(gone)
  }, [sought])
  const shown = sought ?? at
  return (
    <div className="-mx-1 mt-2 flex items-center gap-0.5">
      <span className={time}>{clockOf(held ?? shown)}</span>
      <Track
        value={shown}
        max={duration}
        step={1}
        label={t('进度', 'Progress')}
        text={clockOf}
        hint={over}
        onHeld={setHeld}
        onCommit={(to) => {
          setSought(to)
          command({ kind: 'seek', to })
        }}
        className="flex-1"
      />
      <span className={time}>{clockOf(duration)}</span>
    </div>
  )
}

// IINA's times: 11 pt, the system's digits all one width, secondary, centred in room for an hour's
const time = 'min-w-[46px] px-0.5 text-center text-detail text-shine/60 tabular-nums'

// A slider as IINA's are, greyscale so it doesn't call out: a 3 px bar, white up to the value, and the knob there, a
// thin upright bar (the scrubber's) or a round one (`round`, the volume's, kept within the bar's ends as NSSlider keeps
// it, the input's thumb as wide, so a press anywhere on it holds it). An invisible range input lies over it, so the pointer and the keys work it as a native slider. `onInput` hears it
// move; `onCommit` hears where it's let go of (and each key's step), and while it's held the bar follows the pointer,
// `onHeld` hearing where (and none once let go); with `hint`, the value under the pointer is named over that element.
function Track({
  value,
  max,
  step,
  label,
  text,
  hint,
  round,
  onInput,
  onHeld,
  onCommit,
  className,
}: {
  value: number
  max: number
  step: number
  label: string
  text: (v: number) => string
  hint?: RefObject<HTMLElement | null>
  round?: boolean
  onInput?: (v: number) => void
  onHeld?: (v?: number) => void
  onCommit?: (v: number) => void
  className?: string
}) {
  // where it was pressed and where it's held now; kept in a ref too, for the release heard on the window
  const [held, setHeld] = useState<{ from: number; to: number }>()
  const holding = useRef<typeof held>(undefined)
  const hold = (next?: typeof held) => {
    holding.current = next
    setHeld(next)
    onHeld?.(next?.to)
  }
  // the value under the pointer, and how far above the bar `hint`'s top is
  const [under, setUnder] = useState<{ v: number; above: number }>()
  const shown = held?.to ?? value
  const at = `${max ? (Math.min(shown, max) / max) * 100 : 0}%`
  return (
    <div className={cn('relative h-[15px]', className)}>
      <input
        type="range"
        min={0}
        max={max || 1}
        step={step}
        value={shown}
        aria-label={label}
        aria-valuetext={text(shown)}
        onChange={(e) => {
          const v = Number(e.currentTarget.value)
          onInput?.(v)
          if (holding.current) hold({ ...holding.current, to: v })
          else onCommit?.(v)
        }}
        // let go of anywhere, off the bar too, or the press cancelled; a release where it was pressed was a click on
        // the knob, with nothing to seek. Heard on the window rather than by capturing the pointer, which WebKit's own
        // dragging of the slider needs
        onPointerDown={() => {
          hold({ from: value, to: value })
          const release = () => {
            window.removeEventListener('pointerup', release)
            window.removeEventListener('pointercancel', release)
            const h = holding.current
            if (h && h.to !== h.from) onCommit?.(h.to)
            hold(undefined)
          }
          window.addEventListener('pointerup', release)
          window.addEventListener('pointercancel', release)
        }}
        onPointerMove={(e) => {
          if (!hint) return
          const box = e.currentTarget.getBoundingClientRect()
          const above = box.top - (hint?.current?.getBoundingClientRect().top ?? box.top)
          setUnder({ v: clamp((e.clientX - box.left) / box.width, 0, 1) * max, above })
        }}
        onPointerLeave={() => setUnder(undefined)}
        // its thumb as wide as the knob drawn, so its values run the bar as drawn: none for the scrubber's thin one,
        // the round one's own, which the browser keeps within the ends as the drawing does
        className={cn(
          'peer absolute inset-0 size-full cursor-default appearance-none opacity-0 [&::-webkit-slider-thumb]:appearance-none',
          round ? '[&::-webkit-slider-thumb]:size-3' : '[&::-webkit-slider-thumb]:size-0',
        )}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 peer-focus-visible:[&_.knob]:stroke-focus peer-focus-visible:[&_.knob]:stroke-2',
          round ? 'inset-x-1.5' : 'inset-x-0',
        )}
      >
        <svg aria-hidden="true" className="size-full overflow-visible">
          <line x2="100%" y1="50%" y2="50%" strokeLinecap="round" className="stroke-shine/25 stroke-3" />
          <line x2={at} y1="50%" y2="50%" strokeLinecap="round" className="stroke-shine/85 stroke-3" />
          {round ? (
            <circle cx={at} cy="50%" r="6" className="knob fill-shine drop-shadow-knob" />
          ) : (
            <rect
              x={at}
              width="3"
              height="15"
              rx="1"
              transform="translate(-1.5)"
              className="knob fill-shine drop-shadow-knob"
            />
          )}
          {/* just over that element, the controls, as IINA's time preview is, clear of the buttons (the 字幕 keep
              Player's hintRoom clear of it) */}
          {hint && under && max > 0 && (
            <text
              x={`${clamp((under.v / max) * 100, 4, 96)}%`}
              y={-under.above - 6}
              textAnchor="middle"
              className="fill-shine text-detail tabular-nums [paint-order:stroke] stroke-film/60 stroke-[3px]"
            >
              {text(under.v)}
            </text>
          )}
        </svg>
      </div>
    </div>
  )
}

// One of the controls: a symbol as a borderless button, as AppKit's are (the arrow for a pointer, dimmed while pressed);
// one that opens a `menu` says so.
function Button({
  label,
  icon,
  size,
  medium,
  menu,
  onClick,
  className,
}: {
  label: string
  icon: string
  size: number
  medium?: boolean
  menu?: boolean
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup={menu ? 'menu' : undefined}
      title={label}
      onClick={onClick}
      // a click leaves the focus where it was, as a native control's does, so Space still pauses
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'grid size-6 shrink-0 cursor-default place-items-center rounded-md opacity-90 active:opacity-50 focus-visible:[outline:auto_5px_var(--focus)]',
        className,
      )}
    >
      <Icon name={icon} size={size} medium={medium} />
    </button>
  )
}

// The file's 音轨 and 字幕 as the Mac's players list them (QuickTime's and IINA's 字幕 bubble): a native menu over it,
// 音频 when there are two or more, then 字幕 with 关闭, the one playing ticked, each named as the 作品 page names it.
// macOS shows it modally, so `popup` answers once it's put away: `onMenu` hears it go up and come down, holding the
// controls meanwhile, as the page hears nothing through it. A pick names the version the menu was shown for, so the
// player drops it if the 作品 page has asked for another meanwhile.
function TrackMenu({ s, onMenu }: { s: PlayerState; onMenu: (up: boolean) => void }) {
  const t = useT()
  // the menu last shown and its picks, the app's to free as the next one is made or the page goes (a pick is made on its
  // own, which the app keeps: one made inside Menu.new loses its action as that returns, Tauri 2.12 dropping it with the
  // item it built); whether one is up or on its way, so a second press meanwhile makes no second; and whether the page
  // has gone, so one made after isn't shown
  const last = useRef<Resource[]>([])
  const making = useRef(false)
  const gone = useRef(false)
  const free = () => {
    for (const made of last.current.splice(0)) void made.close()
  }
  useEffect(() => {
    gone.current = false
    return () => {
      gone.current = true
      // one still up is freed once it's put away (`open`'s finally), not under the pointer
      if (!making.current) free()
    }
  }, [])
  const [audio, subtitles] = [s.audio.length > 1, s.subtitles.length > 0]
  // what's on, as the corner says it as it's put on: 音频：国语 AAC 2.0，字幕：英语 SRT
  const [heard, read] = [playingOf(s.audio), playingOf(s.subtitles)]
  const label = [
    audio && trackText(t, t('音频', 'Audio'), heard && audioLabel(heard, t)),
    subtitles && trackText(t, t('字幕', 'Subtitles'), read && subtitleText(read, t)),
  ]
    .filter(Boolean)
    .join(t('，', ', '))
  const open = async (e: MouseEvent<HTMLButtonElement>) => {
    if (making.current) return
    making.current = true
    const box = e.currentTarget.getBoundingClientRect()
    free()
    // an & as itself, which a menu's title would take for the key of the letter after it; each kept to be freed as it's
    // made, so one failing leaves none of the others behind
    const pick = (text: string, checked: boolean, kind: 'audio' | 'subtitle', id: number) =>
      CheckMenuItem.new({
        text: text.replaceAll('&', '&&'),
        checked,
        // the one on already asks nothing, as each switch may ask the network again
        action: () => checked || command({ kind, id, opens: s.opens }),
      }).then((made) => {
        if (gone.current) void made.close()
        else last.current.push(made)
        return made
      })
    // each kind under its name, 音频 then 字幕
    const sections: [string, Promise<CheckMenuItem>[]][] = []
    if (audio) sections.push([t('音频', 'Audio'), s.audio.map((a) => pick(audioLabel(a, t), a.selected, 'audio', a.id))])
    if (subtitles) {
      sections.push([
        t('字幕', 'Subtitles'),
        [
          pick(offText(t), !playingOf(s.subtitles), 'subtitle', noTrack),
          ...subtitlesOf(s.subtitles, t).map((x) => pick(subtitleText(x, t), x.selected, 'subtitle', x.id)),
        ],
      ])
    }
    // whether it went up, as only then does it come down
    let up = false
    try {
      const picks = await Promise.all(sections.map(([, made]) => Promise.all(made)))
      if (gone.current) return
      const items: NonNullable<MenuOptions['items']> = sections.flatMap(([name], i) => [
        ...(i ? [{ item: 'Separator' as const }] : []),
        { text: name, enabled: false },
        ...picks[i],
      ])
      const menu = await Menu.new({ items })
      last.current.push(menu)
      if (gone.current) return free()
      up = true
      onMenu(true)
      // its foot just over the bubble, as tall as its rows and the lines between its parts; under it where the window
      // has no room above
      const tall = menuRoom + menuRow * (sections.length + picks.flat().length) + menuLine * (sections.length - 1)
      const above = box.top - tall - 4
      await menu.popup(new LogicalPosition(box.left, above >= 0 ? above : box.bottom + 4))
    } catch (error) {
      console.error('player: the 音轨 and 字幕 menu', error)
    } finally {
      if (up) onMenu(false)
      making.current = false
      if (gone.current) free()
    }
  }
  return (
    <Button
      label={label}
      icon="captions.bubble"
      size={sizes.tool}
      medium
      menu
      onClick={open}
    />
  )
}
