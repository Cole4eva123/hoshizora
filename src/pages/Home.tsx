import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { History, Pause, Play } from 'lucide-react'
import { PosterRow } from '@/components/PosterRow'
import { Button } from '@/components/ui/button'
import { useRatings } from '@/lib/ratings'
import { cn } from '@/lib/utils'
import {
  type Media,
  type MediaList,
  categories,
  hasToken,
  img,
  originalTitleOf,
  titleOf,
  useTmdb,
  yearOf,
} from '@/lib/tmdb'

const shuffled = <T,>(list: T[]) =>
  list
    .map((x) => [Math.random(), x] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, x]) => x)

const scrollToSlide = (el: HTMLElement | null, i: number) => el?.scrollTo({ left: i * el.clientWidth })

export default function Home() {
  const [first, ...rest] = categories
  return (
    <>
      <h1 className="sr-only">首页</h1>
      <PosterWall>
        <PosterRow category={first} />
      </PosterWall>
      <div className="space-y-10 pt-4 pb-[max(4rem,env(safe-area-inset-bottom))]">
        <ContinueWatching />
        {rest.map((c) => (
          <PosterRow key={c.key} category={c} />
        ))}
      </div>
    </>
  )
}

// The first screen: a swipeable wall of trending backdrops with the first row sitting on its lower edge.
function PosterWall({ children }: { children: ReactNode }) {
  const { data, error } = useTmdb<MediaList>('/trending/all/day')
  const slides = useMemo(
    () => shuffled(data?.results.filter((m) => m.backdrop_path && m.media_type !== 'person') ?? []).slice(0, 8),
    [data],
  )
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const current = slides[index]

  // Swiping changes `index`, which restarts the timer.
  useEffect(() => {
    if (paused || slides.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => scrollToSlide(track.current, (index + 1) % slides.length), 8000)
    return () => clearTimeout(t)
  }, [index, paused, slides.length])

  return (
    <section aria-label="热门推荐" className="relative -ml-(--rail) flex min-h-svh flex-col justify-end pb-6">
      {current && (
        // The current backdrop, blurred, stays behind the whole home page.
        <img
          key={current.id}
          src={img(current.backdrop_path, 'w300')}
          alt=""
          className="pointer-events-none fixed inset-0 -z-10 size-full scale-110 animate-in object-cover opacity-30 blur-3xl duration-1000 fade-in"
        />
      )}
      <div
        ref={track}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="no-scrollbar absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth mask-b-from-45% motion-reduce:scroll-auto"
      >
        {slides.map((m, i) => (
          <img
            key={m.id}
            src={img(m.backdrop_path, 'w1280')}
            alt=""
            loading={i ? 'lazy' : 'eager'}
            className="size-full shrink-0 snap-start object-cover"
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-background/90 via-background/30 to-transparent" />

      <div className="pointer-events-none relative mb-8 flex flex-wrap items-end justify-between gap-6 pr-(--gutter) pl-[calc(var(--rail)+var(--gutter))]">
        {current ? <Info key={current.id} m={current} /> : <Fallback error={error} />}
        {slides.length > 1 && (
          <div className="pointer-events-auto flex items-center gap-2">
            {slides.map((m, i) => (
              <button
                key={m.id}
                aria-label={`第 ${i + 1} 部`}
                aria-current={i === index}
                onClick={() => scrollToSlide(track.current, i)}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === index ? 'w-6 bg-primary' : 'w-1.5 bg-foreground/30 hover:bg-foreground/60',
                )}
              />
            ))}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={paused ? '继续轮播' : '暂停轮播'}
              onClick={() => setPaused(!paused)}
            >
              {paused ? <Play /> : <Pause />}
            </Button>
          </div>
        )}
      </div>
      <div className="relative pl-(--rail)">{children}</div>
    </section>
  )
}

function Info({ m }: { m: Media }) {
  const title = titleOf(m)
  const original = originalTitleOf(m)
  return (
    <div className="max-w-2xl animate-in duration-700 fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
      <p className="flex items-center gap-3 text-sm text-foreground/75">
        <span>{m.media_type === 'tv' ? '剧集' : '电影'}</span>
        <span>{yearOf(m)}</span>
      </p>
      <h2 className="mt-3 line-clamp-2 font-heading text-4xl leading-tight font-black text-balance md:text-6xl">
        {title}
      </h2>
      {original !== title && <p className="mt-2 text-sm text-foreground/60">{original}</p>}
      <Ratings m={m} />
      {m.overview && (
        <p className="mt-4 line-clamp-2 max-w-xl text-[15px] leading-7 text-foreground/80 md:line-clamp-3">
          {m.overview}
        </p>
      )}
    </div>
  )
}

// Each source keeps its own colour so the scores can be told apart at a glance.
function Ratings({ m }: { m: Media }) {
  const r = useRatings(m)
  const rows: [string, string, string | undefined][] = [
    ['TMDB', 'text-(--tmdb)', m.vote_average ? m.vote_average.toFixed(1) : undefined],
    ['IMDb', 'text-[#f5c518]', r.imdb?.toFixed(1)],
    ['烂番茄', 'text-[#fa320a]', r.tomatoes === undefined ? undefined : `${r.tomatoes}%`],
    ['豆瓣', 'text-[#00b51d]', r.douban?.toFixed(1)],
    ['MAL', 'text-[#6f8fe0]', r.mal?.toFixed(2)],
  ]
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {rows
        .filter(([, , v]) => v)
        .map(([label, color, v]) => (
          <span key={label}>
            <span className={cn('mr-1.5 font-semibold', color)}>{label}</span>
            {v}
          </span>
        ))}
    </p>
  )
}

function Fallback({ error }: { error?: string }) {
  if (!error) return <div />
  return (
    <div className="pointer-events-auto max-w-xl">
      <h2 className="font-heading text-4xl font-black md:text-5xl">热门影视会在这里轮播</h2>
      <p className="mt-4 text-[15px] leading-7 text-foreground/75">
        {hasToken ? (
          error
        ) : (
          <>
            还没有配置 TMDB 令牌。在项目根目录新建 <code>.env.local</code>，写入{' '}
            <code>VITE_TMDB_TOKEN=你的读访问令牌</code>，然后重启 <code>bun run dev</code>。
          </>
        )}
      </p>
    </div>
  )
}

function ContinueWatching() {
  return (
    <section className="px-(--gutter)">
      <h2 className="text-lg font-semibold">继续观看</h2>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-dashed px-5 py-5 text-sm text-muted-foreground">
        <History className="size-5 shrink-0" />
        <p className="min-w-48 flex-1">连接 Emby 服务器后，没看完的影片会排在这里，点一下就能接着看。</p>
        <Button asChild variant="secondary" size="sm">
          <Link to="/library">去媒体库</Link>
        </Button>
      </div>
    </section>
  )
}
