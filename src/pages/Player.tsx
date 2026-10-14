import { type WheelEvent, useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Constellation, type Star } from '@/components/Constellation'
import { Option, OptionList } from '@/components/Option'
import { type Translate, localeOf, useT } from '@/lib/i18n'
import { type PlayerState, type PlayerTrack, clockOf, command, usePlayer } from '@/lib/player'
import { asideOf, audioLabel, noTrack, subtitleLabel, subtitlesOf } from '@/lib/tracks'
import { captions, cn, play, wave } from '@/lib/utils'

// The player's own constellations, drawn as the logo's play triangle is (`play`): pause, the speaker and its waves or
// crossed out, and the screen's corners, out to full screen or in, back to the window. Small stars end the lines, so at
// a control's size only the corners stand out.
const pause: Star[][] = [
  [[8, 5], [8, 19]],
  [[16, 5], [16, 19]],
]
const speaker: Star[] = [[3, 9.5, 1], [7, 9.5, 1], [12, 5], [12, 19], [7, 14.5, 1], [3, 14.5, 1], [3, 9.5, 1]]
const sound: Star[][] = [speaker, [[15.5, 9.5, 1], [17.5, 12], [15.5, 14.5, 1]], [[18.5, 6.5, 1], [21.5, 12], [18.5, 17.5, 1]]]
const silent: Star[][] = [speaker, [[16, 9.5, 1], [21, 14.5, 1]], [[21, 9.5, 1], [16, 14.5, 1]]]
const outward: Star[][] = [
  [[3, 8, 1], [3, 3], [8, 3, 1]],
  [[16, 3, 1], [21, 3], [21, 8, 1]],
  [[21, 16, 1], [21, 21], [16, 21, 1]],
  [[8, 21, 1], [3, 21], [3, 16, 1]],
]
const inward: Star[][] = [
  [[3, 8, 1], [8, 8], [8, 3, 1]],
  [[16, 3, 1], [16, 8], [21, 8, 1]],
  [[21, 16, 1], [16, 16], [16, 21, 1]],
  [[8, 21, 1], [8, 16], [3, 16, 1]],
]

// IINA's habits: the controls leave once the pointer has rested 2.5 s; a key's seek is 5 s, its volume step 5
const idle = 2500
const step = { seek: 5, volume: 5 }
// a trackpad's scroll, in pixels, for one step of volume and for a second of seeking: a flick runs to hundreds, its
// momentum included, so a flick is some steps, not all of them
// ponytail: tuned by feel on one trackpad; a mouse wheel's notches may want their own
const scrollPerStep = { volume: 25, seek: 15 }
// a pointer moved this far with its button down drags the window
const dragAfter = 4

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

// the logo's play triangle drawing itself over and over, the player's mark for a wait, as the 作品 page's 播放 does
const tracing = 'text-star drop-shadow-glow-lg [&_polyline]:[stroke-dasharray:1] motion-safe:[&_polyline]:animate-trace-loop'

// The player's page, over the video (src-tauri/src/player): the film alone till the pointer moves; then night rises at
// the foot with the controls in it, and at the top behind the window's own buttons; all of it, the cursor and those
// buttons go once the pointer rests, as in IINA. Its clicks too: one hides them (moving shows them), a double click
// goes full screen, a right click pauses; scrolling up and down sets the volume, sideways seeks; and the keys are IINA's.
export default function Player() {
  const t = useT()
  const s = usePlayer()
  useEffect(() => {
    document.documentElement.lang = localeOf(t) // as the main window's, for screen readers and the glyphs
  }, [t])
  const [awake, setAwake] = useState(true)
  const [over, setOver] = useState(false)
  // a track list open, which is in the top layer, out of the controls the pointer is over
  const [listing, setListing] = useState(false)
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined)
  const wake = () => {
    setAwake(true)
    clearTimeout(rest.current)
    rest.current = setTimeout(() => setAwake(false), idle)
  }
  // from the moment the window opens, so a film started and left alone shows nothing over it
  useEffect(() => {
    rest.current = setTimeout(() => setAwake(false), idle)
    return () => clearTimeout(rest.current)
  }, [])
  // held while paused, at the end, opening or failed, and while the pointer is on them
  const shown = awake || over || listing || !s || s.paused || s.ended || !!s.failed || s.position === undefined
  const opening = s !== undefined && !s.failed && s.position === undefined
  const fullscreen = !!s?.fullscreen
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
      const top = controls.current?.getBoundingClientRect().top ?? innerHeight
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
                      ? trackText(t, t('字幕', 'Subtitles'), subtitle && subtitleLabel(subtitle, t))
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
    // and none while a track list is open, whose keys are its own: its arrows move through it, Esc puts it away (and
    // not full screen)
    if (e.metaKey || e.ctrlKey || e.altKey || pressing || listing || !s) return
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
    // a pinch comes as a wheel with ctrl held, and isn't a scroll; nor is one in a track list, which scrolls itself
    if (s?.position === undefined || e.ctrlKey || listing) return
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

      {/* night at the top, behind the window's buttons and its title */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-16 bg-linear-to-b from-night/60 to-transparent transition-opacity duration-300',
          (!shown || fullscreen) && 'opacity-0',
        )}
      />

      {said && (
        <p
          key={said.n}
          role="status"
          className={cn(
            'pointer-events-none absolute left-5 text-lg font-medium text-foreground tabular-nums text-shadow-night animate-corner',
            fullscreen ? 'top-5' : 'top-11',
          )}
        >
          {said.text}
        </p>
      )}

      {/* waiting on the network mid-film: the play triangle tracing at the middle, after a moment, as a seek within
          what's loaded takes none */}
      {s.waiting && !opening && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Constellation lines={play} className={cn('size-12 animate-appear opacity-0', tracing)} />
        </div>
      )}

      <Opening s={s} shown={opening} />

      {s.failed && (
        // the picture's clicks and drags reach through, so the window still moves
        <div role="alert" className="pointer-events-none absolute inset-0 grid place-items-center bg-night px-8 text-center">
          <div>
            <p className="font-heading text-2xl font-black text-foreground">{t('打不开这个片源', "Couldn't open this source")}</p>
            <p className="mt-3 text-name text-muted-foreground">{s.failed}</p>
          </div>
        </div>
      )}

      {/* night rising at the foot, the controls in it */}
      <div
        onPointerEnter={() => setOver(true)}
        onPointerLeave={() => setOver(false)}
        className={cn(
          'absolute inset-x-0 bottom-0 pt-12 transition-opacity duration-300',
          (!shown || opening || s.failed) && 'pointer-events-none opacity-0',
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-linear-to-t from-night/85 via-night/45 to-transparent" />
        <div ref={controls} className="relative flex items-center gap-4 px-5 pb-4">
          <Button
            label={s.paused || s.ended ? t('播放', 'Play') : t('暂停', 'Pause')}
            lines={s.paused || s.ended ? play : pause}
            onClick={toggle}
            className="size-7"
          />
          <Scrubber s={s} />
          {/* only where there's a choice: two 音轨 or more, one 字幕 or more; none while a version opens, so a list
              open is put away and a pick still waiting isn't sent to it */}
          {!opening && s.audio.length > 1 && (
            <TrackList
              kind="audio"
              label={t('音频', 'Audio')}
              lines={wave}
              tracks={s.audio}
              name={(a) => audioLabel(a, t)}
              onPick={(id) => command({ kind: 'audio', id })}
              onToggle={setListing}
            />
          )}
          {!opening && s.subtitles.length > 0 && (
            <TrackList
              kind="subtitle"
              label={t('字幕', 'Subtitles')}
              lines={captions}
              tracks={subtitlesOf(s.subtitles, t)}
              name={(x) => subtitleLabel(x, t)}
              aside={(x) => asideOf(x, t)}
              off
              onPick={(id) => command({ kind: 'subtitle', id })}
              onToggle={setListing}
            />
          )}
          <Button
            label={s.muted ? t('取消静音', 'Sound on') : t('静音', 'Mute')}
            lines={s.muted || s.volume === 0 ? silent : sound}
            onClick={() => command({ kind: 'toggleMute' })}
          />
          <Track
            value={s.volume}
            max={100}
            step={1}
            label={t('音量', 'Volume')}
            text={(v) => volumeText(v, t)}
            onInput={(volume) => command({ kind: 'volume', volume })}
            className={cn('w-16 max-sm:hidden', s.muted && 'opacity-50')}
          />
          <Button
            label={fullscreen ? t('退出全屏', 'Exit Full Screen') : t('全屏', 'Full Screen')}
            lines={fullscreen ? inward : outward}
            onClick={toggleFullscreen}
          />
        </div>
      </div>
    </main>
  )
}

// While a version opens (seconds on a cloud drive's link): night, the 作品's name in the titles' serif, the logo's play
// triangle tracing under it, and where it picks up, when the user left off; it fades as the film begins.
function Opening({ s, shown }: { s: PlayerState; shown: boolean }) {
  const t = useT()
  return (
    <div
      aria-hidden={!shown}
      className={cn(
        'pointer-events-none absolute inset-0 grid place-items-center bg-night px-8 text-center transition-opacity duration-700',
        !shown && 'opacity-0',
      )}
    >
      <div className="flex flex-col items-center">
        <p className="font-heading text-3xl leading-tight font-black text-balance text-foreground text-shadow-glow">{s.title}</p>
        <Constellation lines={play} className={cn('mt-8 size-10', tracing)} />
        <p className="mt-5 text-name text-muted-foreground">
          {s.from ? t(`从 ${clockOf(s.from)} 继续`, `Picking up at ${clockOf(s.from)}`) : t('正在打开', 'Opening')}
        </p>
      </div>
    </div>
  )
}

// The scrubber: where the film's at between its two times, a dragged position shown till it's let go of and then
// sought, as each seek of a link asks the network again; and, under the pointer, the time it would seek to.
function Scrubber({ s }: { s: PlayerState }) {
  const t = useT()
  const duration = s.duration ?? 0
  const at = s.position ?? 0
  // where it was let go of, shown till mpv is there (its seconds tick on meanwhile), or for 5 s if the seek came to
  // nothing, and never past the file (another version opening); and where the star is held, which the clock follows
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
    <>
      <span className="text-name text-foreground/85 tabular-nums">{clockOf(held ?? shown)}</span>
      <Track
        value={shown}
        max={duration}
        step={1}
        label={t('进度', 'Progress')}
        text={clockOf}
        hint
        onHeld={setHeld}
        onCommit={(to) => {
          setSought(to)
          command({ kind: 'seek', to })
        }}
        className="flex-1"
      />
      <span className="text-name text-foreground/60 tabular-nums">{clockOf(duration)}</span>
    </>
  )
}

// A line of starlight a value runs along, drawn as a constellation is: lit up to the value, where a star is, faint past
// it, and thicker under the pointer. An invisible range input lies over it, so the pointer and the keys work it as a
// native slider. `onInput` hears it move; `onCommit` hears where it's let go of (and each key's step), and while it's
// held the line follows the pointer, `onHeld` hearing where (and none once let go); with `hint`, the value under the
// pointer is named over it.
function Track({
  value,
  max,
  step,
  label,
  text,
  hint,
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
  hint?: boolean
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
  const [under, setUnder] = useState<number>()
  const shown = held?.to ?? value
  const at = `${max ? (Math.min(shown, max) / max) * 100 : 0}%`
  return (
    <div className={cn('group relative h-6', className)}>
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
        // let go of anywhere, off the line too, or the press cancelled; a release where it was pressed was a click on
        // the star, with nothing to seek. Heard on the window rather than by capturing the pointer, which WebKit's own
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
          const box = e.currentTarget.getBoundingClientRect()
          setUnder(clamp((e.clientX - box.left) / box.width, 0, 1) * max)
        }}
        onPointerLeave={() => setUnder(undefined)}
        // its thumb no width at all, so its values run the whole line, as the line and the time over it are drawn
        className="peer absolute inset-0 size-full cursor-pointer appearance-none opacity-0 [&::-webkit-slider-thumb]:size-0 [&::-webkit-slider-thumb]:appearance-none"
      />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full overflow-visible peer-focus-visible:[&_.star]:stroke-ring"
      >
        <line x2="100%" y1="50%" y2="50%" strokeLinecap="round" className={cn(line, 'stroke-foreground/25')} />
        <line x2={at} y1="50%" y2="50%" strokeLinecap="round" className={cn(line, 'stroke-star drop-shadow-glow')} />
        <circle cx={at} cy="50%" r="3.5" className="star fill-shine stroke-2 stroke-transparent drop-shadow-glow-lg" />
        {hint && under !== undefined && max > 0 && (
          <text
            x={`${clamp((under / max) * 100, 4, 96)}%`}
            y="-6"
            textAnchor="middle"
            className="fill-foreground text-detail tabular-nums [paint-order:stroke] stroke-night/70 stroke-[3px]"
          >
            {text(under)}
          </text>
        )}
      </svg>
    </div>
  )
}

// a Track's lines, thicker under the pointer
const line = 'stroke-2 transition-[stroke-width] group-hover:stroke-4'

// Where each list opens from, by CSS anchor names written out whole for Tailwind.
const anchors = {
  audio: ['[anchor-name:--player-audio]', '[position-anchor:--player-audio]'],
  subtitle: ['[anchor-name:--player-subtitle]', '[position-anchor:--player-subtitle]'],
}

// The file's 音轨 or 字幕 while it plays: a control that opens its list above it, a patch of night as the 作品 page's
// lists are, its rows named as there (lib/tracks.ts), the one playing starred; 字幕 can be `off`.
function TrackList({
  kind,
  label,
  lines,
  tracks,
  name,
  aside,
  off,
  onPick,
  onToggle,
}: {
  kind: keyof typeof anchors
  label: string
  lines: Star[][]
  tracks: PlayerTrack[]
  name: (track: PlayerTrack) => string
  aside?: (track: PlayerTrack) => string | undefined
  off?: boolean
  onPick: (id: number) => void
  onToggle: (open: boolean) => void
}) {
  const t = useT()
  const id = useId()
  const [anchor, anchored] = anchors[kind]
  const playing = playingOf(tracks)
  // a pick goes once the list rests on it, as the arrows pick each one they pass and each switch may ask the network
  // again (a version's link); a click's waits as long, unseen behind the list it puts away
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pick = (id: number) => {
    clearTimeout(rest.current)
    rest.current = setTimeout(() => onPick(id), 300)
  }
  // one taken away open (its tracks gone as the next version opens) closes without a toggle event, so it says so; and
  // a pick still waiting isn't for the next version
  const open = useRef(false)
  const toggled = (now: boolean) => {
    open.current = now
    onToggle(now)
    // opened by a click too, the keys go to the list, on the one playing, as a menu's do
    const list = document.getElementById(id)
    if (now) (list?.querySelector<HTMLInputElement>('input:checked') ?? list?.querySelector('input'))?.focus()
  }
  useEffect(
    () => () => {
      clearTimeout(rest.current)
      if (open.current) onToggle(false)
    },
    [onToggle],
  )
  return (
    <>
      <Button
        label={trackText(t, label, playing && name(playing))}
        lines={lines}
        popoverTarget={id}
        anchor={anchor}
      />
      <OptionList
        id={id}
        label={label}
        icon={<Constellation lines={lines} className="size-3.5" />}
        onToggle={toggled}
        className={cn(
          'mb-3 max-h-[min(22rem,60vh)] max-w-[min(26rem,var(--content))] bg-night/85 [position-area:top_span-left] [position-try-fallbacks:flip-block] open:slide-in-from-bottom-1',
          anchored,
        )}
      >
        {/* an arrow moving on drops a pick still waiting, as one back on the track playing picks nothing */}
        <div onKeyDown={(e) => e.key.startsWith('Arrow') && clearTimeout(rest.current)}>
          {off && <Option name={id} picked={!playing} onPick={() => pick(noTrack)} label={offText(t)} />}
          {tracks.map((x) => (
            <Option key={x.id} name={id} picked={x.selected} onPick={() => pick(x.id)} label={name(x)} aside={aside?.(x)} />
          ))}
        </div>
      </OptionList>
    </>
  )
}

// One of the controls: a constellation as a button, quiet till pointed at, when it lights; or one opening a list
// (`popoverTarget`), which it's the `anchor` of.
function Button({
  label,
  lines,
  onClick,
  popoverTarget,
  anchor,
  className,
}: {
  label: string
  lines: Star[][]
  onClick?: () => void
  popoverTarget?: string
  anchor?: string
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      popoverTarget={popoverTarget}
      // a click leaves the focus where it was, as a native control's does, so Space still pauses
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'grid shrink-0 cursor-pointer place-items-center rounded-sm text-foreground/85 transition hover:text-shine hover:drop-shadow-glow',
        anchor,
      )}
    >
      <Constellation lines={lines} className={cn('size-5.5', className)} />
    </button>
  )
}
