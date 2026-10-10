import { useId, useMemo, useState } from 'react'
import { Link, useLocation, useParams, useViewTransitionState } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ChoiceMenu, Choices } from '@/components/Choices'
import { BackButton, Page } from '@/components/Page'
import { Failed, Frame, Row } from '@/components/PosterRow'
import { PosterWall, TitleInfo } from '@/components/PosterWall'
import { type Picked, Sources, Tracks } from '@/components/Sources'
import {
  type EpisodeSource,
  type Server,
  canConnect,
  readAheadOn,
  useEpisodes,
  useSources,
  useLineupAfter,
  useServers,
} from '@/lib/emby'
import { type Translate, useT } from '@/lib/i18n'
import {
  type Details,
  type Episode,
  type From,
  type Lineup,
  type MediaType,
  airDateOf,
  daysUntil,
  hrefOf,
  img,
  lineupOf,
  nextEpisodeText,
  prefetchPerson,
  relativeDays,
  titleOf,
  useDetails,
  useSeason,
  useTitles,
} from '@/lib/tmdb'
import { cn, lit } from '@/lib/utils'

export default function Detail({ type }: { type: MediaType }) {
  const t = useT()
  const { id } = useParams()
  const { details: m, backdrops, error } = useDetails(type, id!)
  const neighbors = useNeighbors(type, id!)
  const preferred = preferredOf(useLocation().state as From | null)

  if (error)
    return (
      <Page title={t('打不开这部作品', "Can't load this title")} back>
        <p className="text-sm text-muted-foreground">{error}</p>
      </Page>
    )
  if (!m) return <BackButton /> // the way back is there before the title arrives
  // keyed by the title, so another one starts over: its wall at the first slide, its 片源 and 选集 its own
  return <TitlePage key={`${type}/${id}`} m={m} backdrops={backdrops} neighbors={neighbors} preferred={preferred} />
}

// A 作品's page once its details are in: the 画报墙, where to watch it under its overview (the app only), then a
// series' 选集, which show which episodes the picked 片源 has, and the cast.
function TitlePage({
  m,
  backdrops,
  neighbors,
  preferred,
}: {
  m: Details
  backdrops: string[]
  neighbors: ReturnType<typeof useNeighbors>
  preferred?: Partial<Picked>
}) {
  const t = useT()
  // The 片源 wanted: the one picked here, or the copy the 作品 was opened from on a 服务器's page (a step from it names
  // the server only). Short of it, that server's first copy, a series' with episodes coming first; with no such server
  // kept, the first kept server's. Only the very copy wanted is read at once (`eager`); the others wait for intent.
  // ponytail: the first kept server even when only another has the 作品, which then has to be picked; take the first
  // that has it if more than one server turns out common.
  const [wanted, setWanted] = useState(preferred)
  const servers = useServers()
  const kept = servers.find((s) => s.id === wanted?.server && s.userId === wanted.user)
  const on = kept ?? servers[0]
  const found = useSources(on, m).sources
  // by its server too, as two servers may number their items alike
  const copy = kept && found?.find((x) => x.item === wanted?.item)
  const item = (copy ?? found?.[0])?.item
  const picked = on && item ? { server: on.id, user: on.userId, item } : undefined
  const facts = [...m.genres.slice(0, 3).map((g) => g.name), m.runtime ? t(`${m.runtime} 分钟`, `${m.runtime} min`) : '']
  return (
    <>
      <PosterWall
        label={t('剧照', 'Stills')}
        backdrops={backdrops}
        info={() => (
          <TitleInfo m={m} as="h1" facts={facts}>
            <p className="mt-4 max-w-xl text-[15px] leading-7 text-foreground/80">
              {m.overview || t('TMDB 上还没有这部作品的中文简介。', 'TMDB has no English overview of this title yet.')}
            </p>
            {canConnect && <Sources m={m} on={on} picked={picked} onPick={setWanted} eager={!!copy} />}
            {neighbors && <Neighbors {...neighbors} />}
          </TitleInfo>
        )}
      />
      <BackButton />
      <div className="space-y-12 pb-(--page-bottom) md:space-y-14">
        {!!m.seasons?.length && <Episodes tv={m} on={on && picked && { s: on, series: picked.item }} />}
        <Cast cast={m.credits.cast} />
      </div>
    </>
  )
}

// the card clicked (`item`) is the one stepped from, not the one stepped to
const stepping = (from: From) => ({ state: { ...from, item: undefined }, replace: true, viewTransition: true })

// The 片源 a 作品 opened from a 服务器's 媒体库 starts on: the card clicked there, or for a step, which names none,
// that server's first.
const preferredOf = (from: From | null): Partial<Picked> | undefined =>
  from?.list && 'library' in from.list ? { server: from.list.server, user: from.list.user, item: from.item } : undefined

// The 作品 before and after this one in the list it was opened from (a 分类, a search, a home row or the wall, an
// actor's 作品, a 服务器's 媒体库). Past the last one loaded from a list that pages on, the next page is asked for and the
// steps go on into it; a list goes round only at its true end, and before the first one. A step replaces the history
// entry, so 返回 still goes back to the list. A title opened from a link of its own has no list, and so no neighbors.
// No ← → keys: after a click in the wall or a row, Chrome scrolls that with the arrows, and the page would step too.
function useNeighbors(type: MediaType, id: string) {
  const from = useLocation().state as From | null
  const indexIn = (lineup: Lineup) => lineup.findIndex((x) => x.media_type === type && `${x.id}` === id)
  const list = from?.list
  const atEnd = !!from && indexIn(from.lineup) === from.lineup.length - 1
  // the next page is TMDB's, or the 服务器's for a 媒体库; the other asks for nothing
  const titles = useTitles(atEnd && list && 'path' in list ? list.path : undefined, (list?.pages ?? 0) + 1)
  const items = useLineupAfter(atEnd && list && 'library' in list ? list : undefined)
  // the list with its next page, once that brings 作品 the lineup didn't have
  // ponytail: a next page that brings none (a 媒体库's 60 with no TMDB entry, or copies of 作品 already in it) ends
  // the list there, and it goes round; ask on page by page while `more` says so if 媒体库 like that turn up.
  const longer = useMemo(() => {
    const lineup = items.lineup ?? (titles.titles && lineupOf(titles.titles))
    return from && list && lineup && lineup.length > from.lineup.length
      ? { lineup, list: { ...list, pages: list.pages + 1 } }
      : undefined
  }, [from, list, titles.titles, items.lineup])
  const all = longer ?? from
  // found again in the longer list, whose first pages, fetched afresh, may have shifted
  const i = all ? indexIn(all.lineup) : -1
  if (!all || i < 0 || all.lineup.length < 2) return
  // while the next page is on its way, there's no next yet, rather than a step back round to the first (if it fails,
  // the list goes round)
  const waiting = (titles.loading && !titles.error) || (items.loading && !items.error)
  return { from: all, prev: all.lineup.at(i - 1)!, next: waiting ? undefined : all.lineup[(i + 1) % all.lineup.length] }
}

// Under the overview, the one before on the left and the one after on the right; with two in the list, they're the
// same 作品, so it shows once, as the next.
function Neighbors({ from, prev, next }: NonNullable<ReturnType<typeof useNeighbors>>) {
  const t = useT()
  return (
    // the wall's info lets clicks through to the stills; these take them
    <nav
      aria-label={t('前后作品', 'Previous and next')}
      className="pointer-events-auto mt-6 flex max-w-xl justify-between gap-6 text-sm text-foreground/60"
    >
      {prev !== next && <Neighbor to={prev} from={from} side="prev" />}
      {next && <Neighbor to={next} from={from} side="next" />}
    </nav>
  )
}

// Asking for its details names the 作品 in the language shown (the lineup keeps the name from when the card was
// clicked), and has its page complete in the first frame when the step comes.
function Neighbor({ to, from, side }: { to: Lineup[number]; from: From; side: 'prev' | 'next' }) {
  const t = useT()
  const { details } = useDetails(to.media_type, `${to.id}`)
  const title = details ? titleOf(details) : to.title
  const Chevron = side === 'prev' ? ChevronLeft : ChevronRight
  return (
    <Link
      to={hrefOf(to)}
      {...stepping(from)}
      aria-label={side === 'prev' ? t(`上一部：${title}`, `Previous: ${title}`) : t(`下一部：${title}`, `Next: ${title}`)}
      className={cn(
        'group flex min-w-0 items-center gap-1 rounded-sm transition-colors hover:text-star',
        side === 'next' && 'ml-auto flex-row-reverse',
      )}
    >
      <Chevron
        className={cn(
          'size-4 shrink-0 transition',
          side === 'prev' ? 'group-hover:-translate-x-0.5' : 'group-hover:translate-x-0.5',
        )}
      />
      <span className="truncate">{title}</span>
    </Link>
  )
}

// A series' 选集. With a 片源 picked (`on`), each episode says whether it's there, and one that is can be picked, its
// 播放, 版本, 音频 and 字幕 showing under the row; pointing at it has the server read its file ahead.
function Episodes({ tv, on }: { tv: Details; on?: { s: Server; series: string } }) {
  const t = useT()
  const seasons = tv.seasons!
  // open on the season that's airing, else the latest one
  const [season, setSeason] = useState(
    tv.next_episode_to_air?.season_number ?? tv.last_episode_to_air?.season_number ?? seasons.at(-1)!.season_number,
  )
  // the episode picked on the 片源, by its server and that server's id for it (two servers may number their items
  // alike), shown while the season shown has it
  const [watching, setWatching] = useState<string>()
  const at = (item: string) => `${on?.s.id}/${on?.s.userId}/${item}`
  const there = useEpisodes(on?.s, on?.series, season)
  const picked = there.episodes?.find((x) => at(x.item) === watching)
  const name = useId()
  // the latest five seasons get a button each; older ones and specials go in the 更多 menu
  const latest = seasons.slice(-5)
  const older = seasons.slice(0, -5)
  const { episodes, error } = useSeason(tv.id, season)
  // an airing season opens at its latest aired episode, with the next one beside it; a finished one at the start
  const next = episodes?.findIndex((e) => !e.air_date || daysUntil(e.air_date) >= 0) ?? -1

  return (
    <div>
      <Row
        title={t('选集', 'Episodes')}
        extra={
          <>
            <p className={cn('mt-1 text-sm', tv.next_episode_to_air ? 'text-primary' : 'text-muted-foreground')}>
              {nextEpisodeText(tv, t)}
            </p>
            {seasons.length > 1 && (
              <Choices
                legend={t('选择一季', 'Season')}
                options={latest.map((s) => ({ key: s.season_number, label: s.name }))}
                value={season}
                onChange={setSeason}
                className="mt-5"
              >
                {older.length > 0 && (
                  <ChoiceMenu
                    label={t('更多季', 'More seasons')}
                    placeholder={t('更多', 'More')}
                    options={older.map((s) => ({ key: s.season_number, label: s.name }))}
                    value={season}
                    onChange={setSeason}
                  />
                )}
              </Choices>
            )}
            {error && <p className="mt-4 text-sm text-muted-foreground">{error}</p>}
            {on && there.error && <Failed error={there.error} retry={there.retry} className="mt-4" />}
            {episodes?.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                {t('这一季还没有分集信息。', 'No episode details for this season yet.')}
              </p>
            )}
          </>
        }
        track="auto-cols-[85%] sm:auto-cols-[calc((100%-1rem)/2)] lg:auto-cols-[calc((100%-2*1rem)/3)] xl:auto-cols-[calc((100%-3*1rem)/4)]"
        start={episodes && Math.max(0, next - 1)}
      >
        {episodes
          ? episodes.map((e) => {
              // the file of this episode, which may hold the next one too (S01E01-E02)
              const { season_number: sn, episode_number: n } = e
              const ep = there.episodes?.find((x) => x.season === sn && x.episode <= n && n <= (x.last ?? x.episode))
              const id = ep && at(ep.item)
              return (
                <EpisodeCard
                  key={e.id}
                  e={e}
                  there={on && ep && { s: on.s, ep, name, picked: id === watching, onPick: () => setWatching(id) }}
                  // the 片源's episodes are in, and this one, aired, isn't one of them
                  missing={!!there.episodes && !ep && !!e.air_date && daysUntil(e.air_date) < 0}
                />
              )
            })
          : !error &&
            Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="aspect-video animate-pulse rounded-lg bg-muted/70" />
            ))}
      </Row>
      {on && picked && (
        <div className="mt-6 px-(--gutter)">
          <p className="mb-3 text-sm text-muted-foreground">{episodesOf(picked, t)}</p>
          <Tracks s={on.s} item={picked.item} given={picked.versions} eager />
        </div>
      )}
    </div>
  )
}

// What an episode on a 片源 is called, a file holding several (S01E01-E02) by all of them.
const episodesOf = ({ season, episode, last }: EpisodeSource, t: Translate) => {
  const n = last ? `${episode}–${last}` : episode
  return t(`第 ${season} 季第 ${n} 集`, `Season ${season}, Episode${last ? 's' : ''} ${n}`)
}

// An episode as TMDB has it. On the picked 片源 (`there`), its title is a radio's label, whose box covers the card, so
// the card takes the click and the radio its name, lit when picked; one not found on the 片源 by its
// numbers (`missing`) is dimmed, and says so. The card's element stays the same as the 片源's episodes come in, so
// the row isn't drawn afresh (its stills fading in again).
// ponytail: matched by season and episode number, as the user's server has few episodes' TMDB ids; one numbered
// otherwise (an anime as one long season) reads as not found. Match by ProviderIds.Tmdb where a server has them.
function EpisodeCard({
  e,
  there,
  missing,
}: {
  e: Episode
  there?: { s: Server; ep: EpisodeSource; name: string; picked: boolean; onPick: () => void }
  missing: boolean
}) {
  const t = useT()
  const days = e.air_date ? daysUntil(e.air_date) : -1
  const name = (
    <>
      <span className={cn(e.name && 'mr-1.5 text-muted-foreground')}>
        {t(`第 ${e.episode_number} 集`, `Episode ${e.episode_number}`)}
      </span>
      {e.name}
    </>
  )
  return (
    <div
      {...(there ? readAheadOn(there.s, there.ep.item, there.ep.versions) : {})}
      className={cn('group relative snap-start', missing && 'opacity-40')}
    >
      <Frame
        src={img(e.still_path, 'w500')}
        className={cn(
          'aspect-video text-3xl',
          there &&
            'transition group-hover:outline-star/40 group-has-focus-visible:outline-2 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-ring',
          there?.picked && cn('outline-star/70 group-hover:outline-star/70', lit),
        )}
      >
        {e.episode_number}
      </Frame>
      <h3 className="mt-2 truncate text-sm font-medium">
        {there ? (
          <label className="cursor-pointer after:absolute after:inset-0">
            <input type="radio" name={there.name} checked={there.picked} onChange={there.onPick} className="sr-only" />
            {name}
          </label>
        ) : (
          name
        )}
      </h3>
      <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>{e.air_date ? airDateOf(e.air_date, t) : t('播出时间未定', 'Air date TBA')}</span>
        {days >= 0 && <span className="text-primary">{relativeDays(days, t)}</span>}
        {!!e.runtime && <span>{t(`${e.runtime} 分钟`, `${e.runtime} min`)}</span>}
        {missing && <span>{t('片源里找不到这一集', 'Not found in this source')}</span>}
      </p>
      {e.overview && <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-foreground/70">{e.overview}</p>}
    </div>
  )
}

function Cast({ cast }: { cast: Details['credits']['cast'] }) {
  const t = useT()
  if (!cast.length) return null
  return (
    <Row title={t('演员', 'Cast')} track="auto-cols-[6rem] sm:auto-cols-[7.5rem]">
      {cast.slice(0, 20).map((p) => (
        <CastCard key={p.credit_id} p={p} />
      ))}
    </Row>
  )
}

// One of the cast, opening their page. Pointing at them asks for it ahead, so it's complete in its first frame and
// the headshot can grow into the page's portrait: both are named portrait for the view transition, this one only
// while it's the one being opened, as the browser skips a transition when two elements share a name.
function CastCard({ p }: { p: Details['credits']['cast'][number] }) {
  const t = useT()
  const to = `/person/${p.id}`
  const opening = useViewTransitionState(to)
  return (
    <Link
      to={to}
      viewTransition
      onPointerEnter={() => prefetchPerson(p.id, t)}
      onFocus={() => prefetchPerson(p.id, t)}
      className="group snap-start"
    >
      {/* TMDB headshots are 2:3, so a 2:3 frame shows the whole photo */}
      <Frame
        src={img(p.profile_path, 'w300')}
        className={cn(
          'aspect-2/3 text-2xl transition group-hover:outline-star/60 group-active:scale-[.97]',
          opening && '[view-transition-name:portrait]',
        )}
      >
        {p.name.slice(0, 1)}
      </Frame>
      <p className="mt-2 truncate text-sm transition-colors group-hover:text-star">{p.name}</p>
      {p.character && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{t(`饰 ${p.character}`, `as ${p.character}`)}</p>
      )}
    </Link>
  )
}
