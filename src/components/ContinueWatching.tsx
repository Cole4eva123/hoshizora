import { useState } from 'react'
import { Link } from 'react-router'
import { Constellation } from '@/components/Constellation'
import { Failed, Frame, Row } from '@/components/PosterRow'
import {
  type Resume,
  type Server,
  episodeOf,
  leftOf,
  lineupOfItems,
  nameOf,
  playErrorText,
  resumeTitle,
  useResume,
} from '@/lib/emby'
import { useT } from '@/lib/i18n'
import { type PlayError, playVersion } from '@/lib/player'
import { type From, type Lineup, hrefOf } from '@/lib/tmdb'
import { play, server } from '@/lib/utils'

// a 剧照 most of a phone's width, the next one peeking in; then three to five to a row
const track = 'auto-cols-[78%] sm:auto-cols-(--span) sm:[--cols:3] lg:[--cols:4] xl:[--cols:5]'

// The 继续观看 of `servers`, the last played first (picked from a prototype: git stash "prototype: 继续观看"), each
// card naming its server where they're shown together (`named`, the home page's, however many there are: the user's
// call); with none, nothing, nor while they're asked for the first time. A server that couldn't be asked says so, with
// 重试. A card's name opens its page on that server's 片源, stepping on through the row's 作品.
export function ContinueWatching({ servers, named = false }: { servers: Server[]; named?: boolean }) {
  const t = useT()
  const { resumes, down, retry } = useResume(servers)
  if (!resumes.length && !down.length) return null
  const lineup = lineupOfItems(resumes.map(({ r }) => ({ id: r.item, name: r.series ?? r.name, tmdb: r.tmdb })))
  return (
    <Row
      title={t('继续观看', 'Continue Watching')}
      extra={down.map((d) => (
        <Failed
          key={`${d.s.id}/${d.s.userId}`}
          error={named ? t(`${nameOf(d.s)}：${d.error}`, `${nameOf(d.s)}: ${d.error}`) : d.error!}
          retry={retry}
          className="mt-2"
        />
      ))}
      track={track}
    >
      {resumes.map(({ s, r }) => (
        <ResumeCard key={`${s.id}/${s.userId}/${r.item}`} s={s} r={r} named={named} lineup={lineup} />
      ))}
    </Row>
  )
}

// A 继续观看: its 剧照, which plays it from where it was left off (dimmed while it opens), the line of starlight up to
// there, its name, which opens its page, and its episode or year with what's left; and its server, `named`.
function ResumeCard({ s, r, named, lineup }: { s: Server; r: Resume; named: boolean; lineup: Lineup }) {
  const t = useT()
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState<PlayError>()
  const title = resumeTitle(r, t)
  const episode = episodeOf(r, t)
  const name = r.series ?? r.name
  // one at a time, as 播放 on a 作品 page
  const resume = () => {
    if (opening) return
    setOpening(true)
    playVersion({ server: s.id, user: s.userId, item: r.item, title })
      .then(
        () => setFailed(undefined),
        (error: PlayError) => setFailed(error),
      )
      .finally(() => setOpening(false))
  }
  return (
    <div className="snap-start">
      <button
        type="button"
        aria-label={t(`接着播 ${title}`, `Resume ${title}`)}
        aria-busy={opening}
        onClick={resume}
        className="group relative block w-full cursor-pointer outline-none aria-busy:cursor-progress aria-busy:opacity-60"
      >
        <Frame
          src={r.still}
          className="aspect-video text-3xl transition group-hover:outline-star/60 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring group-active:scale-[.98]"
        >
          {name.slice(0, 1)}
        </Frame>
        <span className="absolute inset-0 grid place-items-center rounded-lg bg-night/35 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Constellation lines={play} className="size-12 text-shine drop-shadow-glow-lg" />
        </span>
      </button>
      {/* a line high without one, its length unknown, so names stay in line along the row */}
      {r.runtime ? <Progress at={r.position / r.runtime} /> : <div className="mt-2.5 h-2" />}
      <p className="mt-1.5 flex items-baseline gap-2 text-sm">
        {r.tmdb ? (
          <Link
            to={hrefOf(r.tmdb)}
            // the 片源 it's on: a movie's own, an episode's series'
            state={{ lineup, item: r.series ? r.seriesItem : r.item, on: { server: s.id, user: s.userId } } satisfies From}
            viewTransition
            className="truncate transition-colors hover:text-star"
          >
            {name}
          </Link>
        ) : (
          <span className="truncate">{name}</span>
        )}
        {named && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Constellation lines={server} className="size-3.5" />
            {nameOf(s)}
          </span>
        )}
      </p>
      {/* a long episode name cut short, never what's left */}
      <p className="mt-0.5 flex gap-1 text-xs whitespace-pre text-muted-foreground">
        <span className="truncate">
          {episode ? `${episode} · ${r.name} ·` : r.year && `${r.year} ·`}
        </span>
        <span className="shrink-0">{leftOf(r, t)}</span>
      </p>
      {failed && <Failed error={playErrorText(failed, t)} retry={resume} className="mt-2 text-xs" />}
    </div>
  )
}

// Where it was left off, `at` of the way: a line of starlight up to there, a star on it, and the rest faint.
function Progress({ at }: { at: number }) {
  const x = `${Math.min(1, Math.max(0, at)) * 100}%`
  return (
    <svg aria-hidden="true" className="mt-2.5 h-2 w-full overflow-visible">
      <line x1="0" x2="100%" y1="50%" y2="50%" className="stroke-shine/15" strokeWidth={1.5} />
      <line x1="0" x2={x} y1="50%" y2="50%" className="stroke-star drop-shadow-glow" strokeWidth={1.5} />
      <circle cx={x} cy="50%" r={2.5} className="fill-shine drop-shadow-glow" />
    </svg>
  )
}
