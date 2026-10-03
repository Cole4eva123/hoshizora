import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ChevronDown, ChevronLeft } from 'lucide-react'
import { Page } from '@/components/Page'
import { Frame, Row } from '@/components/PosterRow'
import { PosterWall, Title } from '@/components/PosterWall'
import { Ratings } from '@/components/Ratings'
import { Button } from '@/components/ui/button'
import {
  type Details,
  type Episode,
  type MediaType,
  airDate,
  dayOf,
  daysUntil,
  img,
  nextEpisodeText,
  relativeDays,
  releaseOf,
  useDetails,
  useLogo,
  useTmdb,
} from '@/lib/tmdb'
import { cn } from '@/lib/utils'

export default function Detail({ type }: { type: MediaType }) {
  const { id } = useParams()
  const { details: m, error } = useDetails(type, id!)

  if (error)
    return (
      <Page title="打不开这部作品" back>
        <p className="text-sm text-muted-foreground">{error}</p>
      </Page>
    )
  if (!m) return null

  const backdrops = m.images.backdrops.slice(0, 8).map((b) => b.file_path)
  return (
    <>
      <PosterWall
        label="剧照"
        backdrops={backdrops.length || !m.backdrop_path ? backdrops : [m.backdrop_path]}
        info={() => <TitleInfo m={m} />}
      />
      <BackButton />
      <div className="space-y-12 pt-4 pb-[max(4rem,env(safe-area-inset-bottom))]">
        {!!m.seasons?.length && <Episodes tv={m} />}
        <Cast cast={m.credits.cast} />
      </div>
    </>
  )
}

// Back to wherever the title was opened from. A link opened directly has no history in the app, so that goes home.
// Sits beside the corner menu's seal, at its height.
function BackButton() {
  const navigate = useNavigate()
  const { key } = useLocation()
  return (
    <Button
      variant="ghost"
      onClick={() => (key === 'default' ? navigate('/') : navigate(-1))}
      className="absolute top-[max(var(--gutter),env(safe-area-inset-top))] left-[calc(var(--gutter)+3rem)] h-10"
    >
      <ChevronLeft />
      返回
    </Button>
  )
}

function TitleInfo({ m }: { m: Details }) {
  const { ready, logo } = useLogo(m)
  // wait for the logo lookup so the plain title doesn't flash first
  if (!ready) return null
  return (
    <div className="max-w-2xl animate-in duration-700 fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
      <Title m={m} logo={logo} as="h1" />
      <Ratings m={m}>
        <span>{m.media_type === 'tv' ? '剧集' : '电影'}</span>
        <span>{releaseOf(m)}</span>
        {m.genres.slice(0, 3).map((g) => (
          <span key={g.id}>{g.name}</span>
        ))}
        {!!m.runtime && <span>{m.runtime} 分钟</span>}
      </Ratings>
      <p className="mt-4 max-w-xl text-[15px] leading-7 text-foreground/80">
        {m.overview || 'TMDB 上还没有这部作品的中文简介。'}
      </p>
    </div>
  )
}

const pill = (picked: boolean) =>
  cn(
    'cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors hover:bg-card',
    picked && 'border-primary bg-primary/10 text-primary',
  )

function Episodes({ tv }: { tv: Details }) {
  const seasons = tv.seasons!
  // open on the season that's airing, else the latest one
  const [season, setSeason] = useState(
    tv.next_episode_to_air?.season_number ?? tv.last_episode_to_air?.season_number ?? seasons.at(-1)!.season_number,
  )
  // the latest five seasons get a button each; older ones and specials go in the 更多 menu
  const latest = seasons.slice(-5)
  const older = seasons.slice(0, -5)
  const olderPicked = older.some((s) => s.season_number === season)
  const { data, error } = useTmdb<{ season_number: number; episodes: Episode[] }>(`/tv/${tv.id}/season/${season}`)
  // after switching seasons, `data` holds the previous season until the new one arrives
  const episodes = data?.season_number === season ? data.episodes : undefined
  // open at the latest aired episode, with whatever airs next beside it
  const next = episodes?.findIndex((e) => !e.air_date || daysUntil(e.air_date) >= 0) ?? -1

  return (
    <Row
      title="选集"
      extra={
        <>
          <p className={cn('mt-1 text-sm', tv.next_episode_to_air ? 'text-primary' : 'text-muted-foreground')}>
            {nextEpisodeText(tv)}
          </p>
          {seasons.length > 1 && (
            <fieldset className="mt-4 flex flex-wrap gap-2">
              <legend className="sr-only">选择一季</legend>
              {latest.map((s) => (
                <label
                  key={s.id}
                  className={cn(
                    pill(s.season_number === season),
                    'has-focus-visible:outline-2 has-focus-visible:outline-primary',
                  )}
                >
                  <input
                    type="radio"
                    name="season"
                    checked={s.season_number === season}
                    onChange={() => setSeason(s.season_number)}
                    className="sr-only"
                  />
                  {s.name}
                </label>
              ))}
              {older.length > 0 && (
                <div className="relative">
                  <select
                    aria-label="更多季"
                    value={olderPicked ? season : ''}
                    onChange={(e) => setSeason(Number(e.target.value))}
                    className={cn(pill(olderPicked), 'appearance-none pr-9')}
                  >
                    <option value="" disabled hidden>
                      更多
                    </option>
                    {older.map((s) => (
                      <option key={s.id} value={s.season_number}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2" />
                </div>
              )}
            </fieldset>
          )}
          {error && <p className="mt-4 text-sm text-muted-foreground">{error}</p>}
          {episodes?.length === 0 && <p className="mt-4 text-sm text-muted-foreground">这一季还没有分集信息。</p>}
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
  // TMDB names untranslated episodes "第 N 集", so don't print the number twice
  const name = e.name === `第 ${e.episode_number} 集` ? '' : e.name
  const days = e.air_date ? daysUntil(e.air_date) : -1
  return (
    <div className="snap-start">
      <Frame src={img(e.still_path, 'w500')} className="aspect-video text-3xl">
        {e.episode_number}
      </Frame>
      <h3 className="mt-2 truncate text-sm font-medium">
        <span className={cn(name && 'mr-1.5 text-muted-foreground')}>第 {e.episode_number} 集</span>
        {name}
      </h3>
      <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>{e.air_date ? airDate.format(dayOf(e.air_date)) : '播出时间未定'}</span>
        {days >= 0 && <span className="text-primary">{relativeDays.format(days, 'day')}</span>}
        {!!e.runtime && <span>{e.runtime} 分钟</span>}
      </p>
      {e.overview && <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-foreground/70">{e.overview}</p>}
    </div>
  )
}

function Cast({ cast }: { cast: Details['credits']['cast'] }) {
  if (!cast.length) return null
  return (
    <Row title="演员" track="auto-cols-[6rem] sm:auto-cols-[7.5rem]">
      {cast.slice(0, 20).map((p) => (
        <div key={p.credit_id} className="snap-start">
          {/* TMDB headshots are 2:3, so a 2:3 frame shows the whole photo */}
          <Frame src={img(p.profile_path, 'w300')} className="aspect-2/3 text-2xl">
            {p.name.slice(0, 1)}
          </Frame>
          <p className="mt-2 truncate text-sm">{p.name}</p>
          {p.character && <p className="mt-0.5 truncate text-xs text-muted-foreground">饰 {p.character}</p>}
        </div>
      ))}
    </Row>
  )
}
