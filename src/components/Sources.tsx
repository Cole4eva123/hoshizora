import { type ReactNode, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Constellation, ServerMark, type Star } from '@/components/Constellation'
import { Failed } from '@/components/PosterRow'
import {
  type Server,
  type Source,
  type Status,
  type Version,
  nameOf,
  readAheadOn,
  useServers,
  useSources,
  useVersions,
} from '@/lib/emby'
import { useT } from '@/lib/i18n'
import { asideOf, audioLabel, picksOf, releaseNameOf, specOf, subtitleLabel, subtitlesOf } from '@/lib/tracks'
import type { Media } from '@/lib/tmdb'
import { cn, play, star } from '@/lib/utils'

// The 片源 picked: on which server, signed in as whom, and the server's own id for the 作品 there.
export type Picked = { server: string; user: string; item: string }

// What a 片源 plays, drawn like the logo: a cut gem with its girdle across (版本), a sound wave (音频), and a screen with
// two lines of words along its foot (字幕).
const gem: Star[][] = [
  [[3, 9], [8, 4], [16, 4], [21, 9], [12, 20.5], [3, 9]],
  [[3, 9], [21, 9]],
]
const wave: Star[][] = [[[2, 13, 1.1], [6, 13], [9, 5.5], [13, 19], [16, 8.5], [19, 13], [22, 13, 1.1]]]
const captions: Star[][] = [
  [[2, 5], [22, 5], [22, 19], [2, 19], [2, 5]],
  [[6, 12.5, 1.1], [18, 12.5, 1.1]],
  [[6, 15.5, 1.1], [13, 15.5, 1.1]],
]

// Where each list opens from, by CSS anchor names written out whole for Tailwind; a page shows one list of each.
type Kind = 'source' | 'version' | 'audio' | 'subtitle'
const anchor: Record<Kind, string> = {
  source: '[anchor-name:--source]',
  version: '[anchor-name:--version]',
  audio: '[anchor-name:--audio]',
  subtitle: '[anchor-name:--subtitle]',
}
const anchored: Record<Kind, string> = {
  source: '[position-anchor:--source]',
  version: '[position-anchor:--version]',
  audio: '[position-anchor:--audio]',
  subtitle: '[position-anchor:--subtitle]',
}

// Where to watch a 作品, on the 画报墙 under its overview: its 片源 on every kept 服务器, as each answers, one of them
// picked (on the server `on`); for a movie, 播放 and the picked one's 版本, 音频 and 字幕 too (a series' are its picked
// episode's, under 选集). `eager` when the 片源 was picked, not merely the first found: its file is read at once then.
export function Sources({
  m,
  on,
  picked,
  onPick,
  eager,
}: {
  m: Pick<Media, 'media_type' | 'id'>
  on?: Server
  picked?: Picked
  onPick: (p: Picked) => void
  eager: boolean
}) {
  const t = useT()
  const servers = useServers()
  const { sources, error } = useSources(on, m)
  const name = useId()
  if (!servers.length)
    return (
      <p className="pointer-events-auto mt-5 text-sm text-muted-foreground">
        {t('还没有服务器。', 'No servers yet. ')}
        <Link to="/library" viewTransition className="text-star hover:underline">
          {t('到媒体库里添加一台', 'Add one in Library')}
        </Link>
        {t('，就能在这里找到片源。', ' to find sources here.')}
      </p>
    )
  const src = sources?.find((x) => x.item === picked?.item)
  const list = (
    <Menu
      kind="source"
      label={t('片源', 'Source')}
      icon={(className) => <ServerMark status={lightOf(sources, error)} className={className} />}
      current={picked && on && nameOf(on)}
    >
      {servers.map((s) => (
        <Found key={`${s.id}/${s.userId}`} s={s} m={m} name={name} picked={picked} onPick={onPick} />
      ))}
    </Menu>
  )
  return (
    <div className="pointer-events-auto mt-6">
      {m.media_type === 'movie' ? (
        <Tracks
          s={on}
          item={src?.item}
          given={src?.versions ?? []}
          eager={eager}
          why={
            sources
              ? t('这台服务器上没有，在片源里换一台', 'Not on this server: pick another under Source')
              : error
                ? t('没能找片源', "Couldn't look for sources")
                : t('正在找片源', 'Looking for sources')
          }
        >
          {list}
        </Tracks>
      ) : (
        list
      )}
    </div>
  )
}

// A server's light as it's asked for the 作品's 片源: on once it answers, off when it couldn't be asked.
const lightOf = (sources: Source[] | undefined, error: string | undefined): Status =>
  sources ? 'online' : error ? 'offline' : 'checking'

// One server's 片源 of the 作品, an option each; or a line saying it's looking, has none, or couldn't be asked, its
// light saying which. A movie's says what it plays at, or how many versions it has; a series' its seasons there, and
// its name when the server keeps it twice. Resting on a movie's has the server read its file ahead (readAheadOn).
// ponytail: an option says what the server first answered, so after a read it still lacks what it plays at, till the
// next launch; have it peek at the read (versions/{item} in cache.ts) if that ever misleads.
function Found({
  s,
  m,
  name,
  picked,
  onPick,
}: {
  s: Server
  m: Pick<Media, 'media_type' | 'id'>
  name: string
  picked?: Picked
  onPick: (p: Picked) => void
}) {
  const t = useT()
  const { sources, error, retry } = useSources(s, m)
  if (!sources?.length)
    return (
      <div role="status" className="flex items-start gap-1.5 py-1.5 pr-2.5 pl-6.5 text-[13px] leading-5">
        <ServerMark status={lightOf(sources, error)} className="mt-0.5 size-4" />
        <div className="min-w-0 text-foreground/60">
          {nameOf(s)}
          <div className="text-[11px] leading-4 text-muted-foreground">
            {sources ? (
              t('没有这部作品', 'Not on this server')
            ) : error ? (
              <Failed error={error} retry={retry} className="text-[11px]" />
            ) : (
              t('正在找', 'Searching')
            )}
          </div>
        </div>
      </div>
    )
  return sources.map((src) => {
    const series = src.seasons !== undefined
    const v = src.versions[0]
    return (
      <Option
        key={src.item}
        name={name}
        picked={picked?.server === s.id && picked.user === s.userId && picked.item === src.item}
        onPick={() => onPick({ server: s.id, user: s.userId, item: src.item })}
        intent={series ? undefined : readAheadOn(s, src.item, src.versions)}
        mark={<ServerMark status="online" className="size-4" />}
        label={nameOf(s)}
        aside={sources.length > 1 ? src.name : undefined}
        detail={
          series
            ? src.seasons
              ? t(`${src.seasons} 季`, `${src.seasons} season${src.seasons === 1 ? '' : 's'}`)
              : t('没有分集', 'No episodes')
            : src.versions.length > 1
              ? t(`${src.versions.length} 个版本`, `${src.versions.length} versions`)
              : v && (specOf(v) || releaseNameOf(v))
        }
      />
    )
  })
}

// 播放, then what a movie's 片源 or an episode plays: its 版本, 音频 and 字幕, each an icon opening its list, with
// `children` (the 片源's list, on the 画报墙) before them. A file the server hasn't read is read once its tracks are
// wanted: at once when `eager` (a 片源 or an episode picked), else once one of these is pointed at or opened; till then,
// and if it can't be, they're picked in the player. Without an item the three don't open, and say `why`.
export function Tracks({
  s,
  item,
  given,
  eager,
  why,
  children,
}: {
  s?: Server
  item?: string
  given: Version[]
  eager: boolean
  why?: string
  children?: ReactNode
}) {
  const t = useT()
  const at = `${s?.id}/${s?.userId}/${item}`
  // the item whose list was opened, which wants its file read as a pick does
  const [opened, setOpened] = useState<string>()
  const { versions, reading, error, retry } = useVersions(s, item, given, eager || opened === at)
  const name = useId()
  // What's been picked here, the rest being the version's defaults; the version by its id, as the server's read may
  // list them in another order. Another item starts over, on its own defaults (picksOf).
  const [picks, setPicks] = useState<{ at?: string; version?: string; audio?: number; subtitle?: number }>({})
  const own = picks.at === at ? picks : { at }
  const v: Version | undefined = versions.find((x) => x.id === own.version) ?? versions[0]
  const defaults = v && picksOf(v, t)
  const audio = own.audio ?? defaults?.audio
  const subtitle = own.subtitle ?? defaults?.subtitle
  const subtitles = v ? subtitlesOf(v, t) : []
  const a = v?.audio.find((x) => x.index === audio)
  const sub = subtitles.find((x) => x.index === subtitle)
  const menu = {
    why: item ? undefined : why,
    onOpen: () => setOpened(at),
    intent: s && item ? readAheadOn(s, item, given) : undefined,
  }
  // in place of the 音轨 and 字幕 while the server reads the file, or when it can't
  const unread = (
    <div role="status" className="max-w-64 px-2.5 py-1.5 text-[13px] leading-5 text-muted-foreground">
      {reading ? (
        t('正在读取音频和字幕，第一次要几秒', 'Reading the audio and subtitles, a few seconds the first time')
      ) : error ? (
        <Failed error={error} retry={retry} className="text-[13px]" />
      ) : (
        t('音频和字幕播放时再选', 'Pick the audio and subtitles when playing')
      )}
    </div>
  )
  return (
    <div className="flex items-center gap-7">
      <Play reading={reading} />
      <div className="flex items-start gap-5">
        {children}
        <Menu
          kind="version"
          label={t('版本', 'Version')}
          icon={(className) => <Constellation lines={gem} className={className} />}
          current={v && releaseNameOf(v)}
          {...menu}
        >
          {versions.map((x) => (
            <Option
              key={x.id}
              name={`${name}v`}
              picked={x.id === v?.id}
              onPick={() => setPicks({ at, version: x.id })}
              label={releaseNameOf(x)}
              // the server's name for it too, where two are one release (copies in two folders)
              aside={versions.some((y) => y !== x && releaseNameOf(y) === releaseNameOf(x)) ? x.name : undefined}
              detail={specOf(x)}
            />
          ))}
        </Menu>
        <Menu
          kind="audio"
          label={t('音频', 'Audio')}
          icon={(className) => <Constellation lines={wave} className={className} />}
          current={v?.video && a && audioLabel(a, t)}
          {...menu}
        >
          {!v?.video
            ? unread
            : v.audio.length
              ? v.audio.map((x) => (
                  <Option
                    key={x.index}
                    name={`${name}a`}
                    picked={x.index === audio}
                    onPick={() => setPicks({ ...own, audio: x.index })}
                    label={audioLabel(x, t)}
                  />
                ))
              : <p className="px-2.5 py-1.5 text-[13px] text-muted-foreground">{t('没有音轨', 'No audio')}</p>}
        </Menu>
        <Menu
          kind="subtitle"
          label={t('字幕', 'Subtitles')}
          icon={(className) => <Constellation lines={captions} className={className} />}
          current={v?.video && (subtitle === -1 ? t('关闭', 'Off') : sub && subtitleLabel(sub, t))}
          {...menu}
        >
          {!v?.video ? (
            unread
          ) : (
            <>
              <Option
                name={`${name}s`}
                picked={subtitle === -1}
                onPick={() => setPicks({ ...own, subtitle: -1 })}
                label={t('关闭', 'Off')}
              />
              {/* those in the language shown first; a film can carry thirty, so the list scrolls */}
              {subtitles.map((x) => (
                <Option
                  key={x.index}
                  name={`${name}s`}
                  picked={x.index === subtitle}
                  onPick={() => setPicks({ ...own, subtitle: x.index })}
                  label={subtitleLabel(x, t)}
                  aside={asideOf(x, t)}
                />
              ))}
            </>
          )}
        </Menu>
      </div>
    </div>
  )
}

// An icon on the 画报墙 that opens its list under it: the constellation bare, its word small under it, starlight and a
// glow on hover and while the list is out, when the star under the word lights too. The list is a patch of night with
// no edge, its options radios (Option). A pick puts it away, though not one made with the arrow keys, which move through
// the list (Enter or Escape puts it away then). One that can't open says `why`, in its title, and stays focusable to
// say it; `intent` goes on its wrapper, to read a file ahead.
function Menu({
  kind,
  label,
  icon,
  current,
  why,
  onOpen,
  intent,
  children,
}: {
  kind: Kind
  label: string
  icon: (className: string) => ReactNode
  current?: string
  why?: string
  onOpen?: () => void
  intent?: ReturnType<typeof readAheadOn>
  children: ReactNode
}) {
  const t = useT()
  const id = useId()
  const arrows = useRef(false)
  return (
    <div {...intent}>
      <button
        type="button"
        popoverTarget={why ? undefined : id}
        aria-disabled={!!why}
        title={why ?? current}
        aria-label={current ? t(`${label}：${current}`, `${label}: ${current}`) : label}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-1.5 text-[11px] leading-none text-foreground/55 transition-colors not-aria-disabled:hover:text-star aria-disabled:cursor-not-allowed aria-disabled:opacity-35',
          '[&_svg]:transition-[filter] not-aria-disabled:hover:[&_svg]:drop-shadow-[0_0_6px_var(--glow)]',
          star,
          'after:-bottom-2 after:opacity-0 after:transition-opacity',
          '[&:has(+:popover-open)]:text-star [&:has(+:popover-open)]:after:opacity-100 [&:has(+:popover-open)_svg]:drop-shadow-[0_0_6px_var(--glow)]',
          anchor[kind],
        )}
      >
        {icon('size-6')}
        {label}
      </button>
      <div
        id={id}
        popover="auto"
        onToggle={(e) => e.newState === 'open' && onOpen?.()}
        onPointerDown={() => (arrows.current = false)}
        onKeyDown={(e) => {
          arrows.current = e.key.startsWith('Arrow')
          if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return // not a 重试 button's
          e.preventDefault() // or the focus, back on the button, takes the Enter and opens the list again
          e.currentTarget.hidePopover()
        }}
        onChange={(e) => arrows.current || e.currentTarget.hidePopover()}
        className={cn(
          'inset-auto m-0 mt-2.5 max-h-[min(22rem,40vh)] w-max max-w-[min(26rem,calc(100vw-2rem))] min-w-48 overflow-y-auto overscroll-contain rounded-xl border-0 bg-night/75 p-1 text-foreground shadow-2xl shadow-night backdrop-blur-xl [position-area:bottom_span-right] [position-try-fallbacks:flip-block]',
          // centred in the window where WebKit places nothing by anchors (before Safari 26)
          'not-supports-[anchor-name:--a]:inset-0 not-supports-[anchor-name:--a]:m-auto',
          'open:animate-in open:fade-in open:slide-in-from-top-1',
          anchored[kind],
        )}
      >
        <fieldset className="min-w-0">
          <legend className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[11px] text-muted-foreground">
            {icon('size-3.5')}
            {label}
          </legend>
          {children}
        </fieldset>
      </div>
    </div>
  )
}

// One option in a Menu's list: a radio drawn as its name, a word `aside` it and a line of `detail` under it (what a
// 版本 plays at), the picked one starred and brighter.
function Option({
  name,
  picked,
  onPick,
  intent,
  mark,
  label,
  aside,
  detail,
}: {
  name: string
  picked: boolean
  onPick: () => void
  intent?: ReturnType<typeof readAheadOn>
  mark?: ReactNode
  label: string
  aside?: string
  detail?: string
}) {
  return (
    <label
      {...intent}
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-star/6 hover:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring',
        picked ? 'text-foreground' : 'text-foreground/60',
      )}
    >
      <input type="radio" name={name} checked={picked} onChange={onPick} className="sr-only" />
      <span
        className={cn(
          'mt-[7px] size-1.5 shrink-0 rounded-full bg-star shadow-[0_0_6px_1px_var(--glow)]',
          !picked && 'opacity-0',
        )}
      />
      <span className="min-w-0">
        <span title={label} className="flex items-center gap-1.5 text-[13px] leading-5 whitespace-nowrap">
          {mark}
          <span className="truncate">{label}</span>
          {aside && <span className="text-[11px] text-muted-foreground">{aside}</span>}
        </span>
        {detail && <span className="block text-[11px] leading-4 text-muted-foreground tabular-nums">{detail}</span>}
      </span>
    </label>
  )
}

// 播放, the logo's triangle alone, glowing, its lines drawing in as the page opens and over and over while the server
// reads the file. It plays nothing yet: the player comes next (docs/playback-plan.md, M1 and M2).
function Play({ reading }: { reading: boolean }) {
  const t = useT()
  return (
    // focusable, though it does nothing, so its title can say why
    <button
      type="button"
      aria-disabled
      aria-label={t('播放', 'Play')}
      title={t('播放器还在做', "The player isn't ready yet")}
      className="grid size-11 shrink-0 cursor-not-allowed place-items-center text-star drop-shadow-[0_0_10px_var(--glow)]"
    >
      <Constellation
        lines={play}
        className={cn(
          'size-full [&_polyline]:[stroke-dasharray:1]',
          // one of the two only, as Tailwind writes the named one after the other, where it would win
          reading
            ? 'motion-safe:[&_polyline]:animate-[trace_1.6s_ease-in-out_infinite]'
            : 'motion-safe:[&_polyline]:animate-trace',
        )}
      />
    </button>
  )
}
