import { Fragment, useState } from 'react'
import { Link, useParams, useViewTransitionState } from 'react-router'
import { ChevronDown } from 'lucide-react'
import { Choices } from '@/components/Choices'
import { BackButton, Page } from '@/components/Page'
import { Frame, Row } from '@/components/PosterRow'
import { PosterWall, TitleInfo } from '@/components/PosterWall'
import { useT } from '@/lib/i18n'
import {
  type Details,
  type Episode,
  type MediaType,
  airDateOf,
  daysUntil,
  img,
  nextEpisodeText,
  prefetchPerson,
  relativeDays,
  useDetails,
  useSeason,
} from '@/lib/tmdb'
import { choice, cn } from '@/lib/utils'

export default function Detail({ type }: { type: MediaType }) {
  const t = useT()
  const { id } = useParams()
  const { details: m, backdrops, error } = useDetails(type, id!)

  if (error)
    return (
      <Page title={t('打不开这部作品', "Can't load this title")} back>
        <p className="text-sm text-muted-foreground">{error}</p>
      </Page>
    )
  if (!m) return <BackButton /> // the way back is there before the title arrives

  const facts = [...m.genres.slice(0, 3).map((g) => g.name), m.runtime ? t(`${m.runtime} 分钟`, `${m.runtime} min`) : '']
  return (
    // keyed by the title, so another one starts over: its wall at the first slide, its 选集 at its own season
    <Fragment key={`${type}/${id}`}>
      <PosterWall
        label={t('剧照', 'Stills')}
        backdrops={backdrops}
        info={() => (
          <TitleInfo m={m} as="h1" facts={facts}>
            <p className="mt-4 max-w-xl text-[15px] leading-7 text-foreground/80">
              {m.overview || t('TMDB 上还没有这部作品的中文简介。', 'TMDB has no English overview of this title yet.')}
            </p>
          </TitleInfo>
        )}
      />
      <BackButton />
      <div className="space-y-12 pt-6 pb-(--page-bottom) md:space-y-14">
        {!!m.seasons?.length && <Episodes tv={m} />}
        <Cast cast={m.credits.cast} />
      </div>
    </Fragment>
  )
}

function Episodes({ tv }: { tv: Details }) {
  const t = useT()
  const seasons = tv.seasons!
  // open on the season that's airing, else the latest one
  const [season, setSeason] = useState(
    tv.next_episode_to_air?.season_number ?? tv.last_episode_to_air?.season_number ?? seasons.at(-1)!.season_number,
  )
  // the latest five seasons get a button each; older ones and specials go in the 更多 menu
  const latest = seasons.slice(-5)
  const older = seasons.slice(0, -5)
  const olderPicked = older.some((s) => s.season_number === season)
  const { episodes, error } = useSeason(tv.id, season)
  // an airing season opens at its latest aired episode, with the next one beside it; a finished one at the start
  const next = episodes?.findIndex((e) => !e.air_date || daysUntil(e.air_date) >= 0) ?? -1

  return (
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
                // the star and the focus ring go on the wrapper, as a select draws no ::after
                <div className={choice(olderPicked)}>
                  <select
                    aria-label={t('更多季', 'More seasons')}
                    value={olderPicked ? season : ''}
                    onChange={(e) => setSeason(Number(e.target.value))}
                    className="cursor-pointer appearance-none bg-transparent pr-5 outline-none"
                  >
                    <option value="" disabled hidden>
                      {t('更多', 'More')}
                    </option>
                    {older.map((s) => (
                      <option key={s.id} value={s.season_number}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-0 size-4 -translate-y-1/2" />
                </div>
              )}
            </Choices>
          )}
          {error && <p className="mt-4 text-sm text-muted-foreground">{error}</p>}
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
        ? episodes.map((e) => <EpisodeCard key={e.id} e={e} />)
        : !error &&
          Array.from({ length: 4 }, (_, i) => <div key={i} className="aspect-video animate-pulse rounded-lg bg-muted/70" />)}
    </Row>
  )
}

function EpisodeCard({ e }: { e: Episode }) {
  const t = useT()
  const days = e.air_date ? daysUntil(e.air_date) : -1
  return (
    <div className="snap-start">
      <Frame src={img(e.still_path, 'w500')} className="aspect-video text-3xl">
        {e.episode_number}
      </Frame>
      <h3 className="mt-2 truncate text-sm font-medium">
        <span className={cn(e.name && 'mr-1.5 text-muted-foreground')}>
          {t(`第 ${e.episode_number} 集`, `Episode ${e.episode_number}`)}
        </span>
        {e.name}
      </h3>
      <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>{e.air_date ? airDateOf(e.air_date, t) : t('播出时间未定', 'Air date TBA')}</span>
        {days >= 0 && <span className="text-primary">{relativeDays(days, t)}</span>}
        {!!e.runtime && <span>{t(`${e.runtime} 分钟`, `${e.runtime} min`)}</span>}
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
