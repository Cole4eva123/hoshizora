import { type ReactNode, useId, useState } from 'react'
import { Link } from 'react-router'
import { ChoiceMenu, Choices } from '@/components/Choices'
import { Constellation, ServerMark } from '@/components/Constellation'
import { EmptyState } from '@/components/Page'
import { Failed, Row } from '@/components/PosterRow'
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
import { audioLabel, picksOf, qualityOf, subtitleLabel, subtitlesOf } from '@/lib/tracks'
import type { Media } from '@/lib/tmdb'
import { cn, lit, play, star } from '@/lib/utils'

// The 片源 picked: on which server, signed in as whom, and the server's own id for the 作品 there.
export type Picked = { server: string; user: string; item: string }

// A 作品's 片源 on every kept 服务器, each server's as soon as it answers, as a row of radios: one is picked to play,
// on the server `on`. Under them, a movie's picked 片源 shows its 清晰度, 音轨 and 字幕; a series' picks the 选集 shown
// (Detail).
export function Sources({
  m,
  on,
  picked,
  onPick,
}: {
  m: Pick<Media, 'media_type' | 'id'>
  on?: Server
  picked?: Picked
  onPick: (p: Picked) => void
}) {
  const t = useT()
  const servers = useServers()
  const name = useId()
  if (!servers.length)
    return (
      <div className="px-(--gutter)">
        <EmptyState title={t('片源', 'Sources')}>
          {t('还没有服务器。', 'No servers yet. ')}
          <Link to="/library" viewTransition className="text-star hover:underline">
            {t('到媒体库里添加一台', 'Add one in Library')}
          </Link>
          {t('，就能在这里找到片源。', ' to find sources here.')}
        </EmptyState>
      </div>
    )
  return (
    <div>
      <Row title={t('片源', 'Sources')} track="auto-cols-[13rem] sm:auto-cols-[15rem]">
        {servers.map((s) => (
          <Found key={`${s.id}/${s.userId}`} s={s} m={m} name={name} picked={picked} onPick={onPick} />
        ))}
      </Row>
      {m.media_type === 'movie' && on && picked && (
        // keyed by server as well, as two servers may number their items alike
        <MovieTracks key={`${picked.server}/${picked.user}/${picked.item}`} s={on} m={m} item={picked.item} />
      )}
    </div>
  )
}

// One server's 片源 of the 作品, a tile each; or one tile saying it's looking, has none, or couldn't be asked.
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
  if (!sources)
    return (
      <Note s={s} status={error ? 'offline' : 'checking'}>
        {error ? <Failed error={error} retry={retry} /> : t('正在找', 'Searching')}
      </Note>
    )
  if (!sources.length)
    return (
      <Note s={s} status="online">
        {t('没有这部作品', 'Not on this server')}
      </Note>
    )
  return sources.map((src) => (
    <SourceTile
      key={src.item}
      s={s}
      src={src}
      name={name}
      picked={picked?.server === s.id && picked.user === s.userId && picked.item === src.item}
      dimmed={!!picked}
      onPick={() => onPick({ server: s.id, user: s.userId, item: src.item })}
    />
  ))
}

// A 片源, a radio among them all, lit like a 媒体库's cover: the picked one glows and its 清晰度 is starred, the others
// dim until pointed at. A movie's says its 清晰度 and size; a series' its seasons there, and its name, as a server
// keeping it twice names the copies apart. Resting on a movie's has the server read its file ahead (readAheadOn).
// ponytail: a tile says what the server first answered, so after a read its 清晰度 is still the one its name gave, till
// the next launch; have it peek at the read (versions/{item} in cache.ts) if that ever misleads.
function SourceTile({
  s,
  src,
  name,
  picked,
  dimmed,
  onPick,
}: {
  s: Server
  src: Source
  name: string
  picked: boolean
  dimmed: boolean
  onPick: () => void
}) {
  const t = useT()
  const v = src.versions[0]
  const series = src.seasons !== undefined
  const headline = series
    ? src.seasons
      ? t(`${src.seasons} 季`, `${src.seasons} season${src.seasons === 1 ? '' : 's'}`)
      : t('没有分集', 'No episodes')
    : [...new Set(src.versions.map(qualityOf).filter(Boolean))].join(' / ') || t('清晰度未知', 'Unknown quality')
  // the version's name when it says more than the 清晰度 and the 作品's own name (2160p - WEB-DL HQ, not 4k)
  const detail = series
    ? src.name
    : v && ![src.name, headline].some((x) => x.toLowerCase() === v.name.toLowerCase())
      ? v.name
      : undefined
  return (
    <label
      {...(series ? {} : readAheadOn(s, src.item, src.versions))}
      className={cn(
        'flex snap-start cursor-pointer flex-col rounded-2xl bg-card p-4 inset-ring transition has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
        picked
          ? cn('inset-ring-star/70', lit)
          : cn('inset-ring-star/15 hover:inset-ring-star/40', dimmed && 'opacity-50 hover:opacity-100'),
      )}
    >
      <input type="radio" name={name} checked={picked} onChange={onPick} className="sr-only" />
      <ServerLabel s={s} status="online" />
      <span
        className={cn(
          star,
          'mt-3 w-fit font-heading text-xl font-black after:opacity-0 after:transition-opacity',
          picked && 'after:opacity-100',
          series && !src.seasons && 'text-muted-foreground',
        )}
      >
        {headline}
      </span>
      <span className="mt-1.5 flex min-w-0 gap-x-2 text-xs text-muted-foreground">
        {detail && <span className="truncate">{detail}</span>}
        {v?.size && <span className="shrink-0">{(v.size / 2 ** 30).toFixed(1)} GB</span>}
      </span>
    </label>
  )
}

// A tile's first line: its server, the star of whose constellation is its light.
function ServerLabel({ s, status }: { s: Server; status: Status }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <ServerMark status={status} className="size-5" />
      <span className="truncate">{nameOf(s)}</span>
    </span>
  )
}

// A server with no 片源 to show yet: looking, none there, or it couldn't be asked, its light saying which.
function Note({ s, status, children }: { s: Server; status: Status; children: ReactNode }) {
  return (
    <div className="flex snap-start flex-col rounded-2xl p-4 inset-ring inset-ring-star/10">
      <ServerLabel s={s} status={status} />
      <div role="status" className="mt-3 text-sm text-muted-foreground">
        {children}
      </div>
    </div>
  )
}

// The picked movie 片源's 清晰度, 音轨 and 字幕, from what the server found (asked once, kept in cache.ts).
function MovieTracks({ s, m, item }: { s: Server; m: Pick<Media, 'media_type' | 'id'>; item: string }) {
  const src = useSources(s, m).sources?.find((x) => x.item === item)
  return src ? <Tracks s={s} item={item} given={src.versions} /> : null
}

// What a 片源 or an episode plays: its 清晰度 (a choice when it has several versions), its 音轨 and 字幕, each a row
// of choices, and the 播放 button. A file the server hasn't read is read now (useVersions); till then, and if it
// can't be, they're picked in the player. Keyed by the item, so another starts over on its own defaults (picksOf).
export function Tracks({ s, item, given, title }: { s: Server; item: string; given: Version[]; title?: string }) {
  const t = useT()
  const { versions, reading, error, retry } = useVersions(s, item, given)
  // What's been picked here, the rest being the version's defaults; the version by its id, as the server's read may
  // list them in another order.
  const [picks, setPicks] = useState<{ version?: string; audio?: number; subtitle?: number }>({})
  const v: Version | undefined = versions.find((x) => x.id === picks.version) ?? versions[0]
  const defaults = v && picksOf(v, t)
  const audio = picks.audio ?? defaults?.audio
  const subtitle = picks.subtitle ?? defaults?.subtitle
  const quality = v && (qualityOf(v) ?? t('清晰度未知', 'Unknown quality'))
  return (
    <div className="mt-6 px-(--gutter)">
      {title && <p className="mb-4 font-heading text-lg font-black">{title}</p>}
      {/* the labels' column as wide in both languages and either state, so nothing shifts as the tracks come in */}
      <dl className="grid max-w-3xl grid-cols-[4.5rem_1fr] items-baseline gap-x-6 gap-y-4">
        <dt className="text-sm text-muted-foreground">{t('清晰度', 'Quality')}</dt>
        <dd>
          {versions.length > 1 ? (
            <Choices
              legend={t('清晰度', 'Quality')}
              // by their names when two share a 清晰度 (1080p - BluRay, 1080p - WEB-DL)
              options={versions.map((x) => {
                const q = qualityOf(x)
                return { key: x.id, label: q && versions.filter((y) => qualityOf(y) === q).length < 2 ? q : x.name }
              })}
              value={v!.id}
              onChange={(id) => setPicks({ version: id })}
            />
          ) : (
            <span className="text-[15px]">{quality}</span>
          )}
        </dd>
        {v?.video ? (
          <>
            <dt className="text-sm text-muted-foreground">{t('音频', 'Audio')}</dt>
            <dd>
              {v.audio.length > 1 ? (
                <Choices
                  legend={t('音频', 'Audio')}
                  options={v.audio.map((a) => ({ key: a.index, label: audioLabel(a, t) }))}
                  value={audio!}
                  onChange={(i) => setPicks({ ...picks, audio: i })}
                />
              ) : (
                <span className="text-[15px]">
                  {v.audio[0] ? audioLabel(v.audio[0], t) : t('没有音轨', 'No audio')}
                </span>
              )}
            </dd>
            <dt className="text-sm text-muted-foreground">{t('字幕', 'Subtitles')}</dt>
            <dd>
              <Subtitles v={v} value={subtitle!} onChange={(i) => setPicks({ ...picks, subtitle: i })} />
            </dd>
          </>
        ) : (
          <>
            <dt className="sr-only">{t('音频和字幕', 'Audio and subtitles')}</dt>
            <dd role="status" className="col-start-2 text-[15px] text-muted-foreground">
              {reading ? (
                t('正在读取音频和字幕，第一次要几秒', 'Reading the audio and subtitles, a few seconds the first time')
              ) : error ? (
                <Failed error={error} retry={retry} />
              ) : (
                t('音频和字幕播放时再选', 'Pick the audio and subtitles when playing')
              )}
            </dd>
          </>
        )}
      </dl>
      <Play reading={reading} />
    </div>
  )
}

// The 字幕 as choices, off first, then those in the language shown; past six, the rest in a 更多 menu, as a film can
// carry thirty.
function Subtitles({ v, value, onChange }: { v: Version; value: number; onChange: (index: number) => void }) {
  const t = useT()
  const all = subtitlesOf(v, t)
  const shown = all.slice(0, 6)
  const more = all.slice(6)
  return (
    <Choices
      legend={t('字幕', 'Subtitles')}
      options={[
        { key: -1, label: t('关闭', 'Off') },
        ...shown.map((s) => ({ key: s.index, label: subtitleLabel(s, t) })),
      ]}
      value={value}
      onChange={onChange}
    >
      {more.length > 0 && (
        <ChoiceMenu
          label={t('更多字幕', 'More subtitles')}
          placeholder={t('更多', 'More')}
          options={more.map((s) => ({ key: s.index, label: subtitleLabel(s, t) }))}
          value={value}
          onChange={onChange}
        />
      )}
    </Choices>
  )
}

// 播放, its mark the logo's triangle of stars, its lines drawing in as the 片源 opens and over and over while the
// server reads the file. It plays nothing yet: the player comes next (docs/playback-plan.md, M1 and M2).
function Play({ reading }: { reading: boolean }) {
  const t = useT()
  const why = useId()
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="button"
        disabled
        aria-describedby={why}
        className="flex items-center gap-3 rounded-full py-2.5 pr-6 pl-4 font-heading text-lg font-black text-star inset-ring inset-ring-star/40 disabled:cursor-not-allowed"
      >
        <Constellation
          lines={play}
          className={cn(
            'size-7 [&_polyline]:[stroke-dasharray:1]',
            // one of the two only, as Tailwind writes the named one after the other, where it would win
            reading
              ? 'motion-safe:[&_polyline]:animate-[trace_1.6s_ease-in-out_infinite]'
              : 'motion-safe:[&_polyline]:animate-trace',
          )}
        />
        {t('播放', 'Play')}
      </button>
      <p id={why} className="text-sm text-muted-foreground">
        {t('播放器还在做', "The player isn't ready yet")}
      </p>
    </div>
  )
}
