import { type ReactNode, useMemo } from 'react'
import { Link } from 'react-router'
import { History } from 'lucide-react'
import { PosterRow } from '@/components/PosterRow'
import { PosterWall, Title } from '@/components/PosterWall'
import { Ratings } from '@/components/Ratings'
import { Button } from '@/components/ui/button'
import { type Media, type MediaList, categories, hasToken, releaseOf, useLogo, useTmdb } from '@/lib/tmdb'

const shuffled = <T,>(list: T[]) =>
  list
    .map((x) => [Math.random(), x] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, x]) => x)

export default function Home() {
  const [first, ...rest] = categories
  return (
    <>
      <h1 className="sr-only">首页</h1>
      <TrendingWall>
        <PosterRow category={first} />
      </TrendingWall>
      <div className="space-y-10 pt-4 pb-[max(4rem,env(safe-area-inset-bottom))]">
        <ContinueWatching />
        {rest.map((c) => (
          <PosterRow key={c.key} category={c} />
        ))}
      </div>
    </>
  )
}

// The first screen: today's trending titles on the poster wall, with the first row sitting on its lower edge.
function TrendingWall({ children }: { children: ReactNode }) {
  const { data, error } = useTmdb<MediaList>('/trending/all/day')
  const slides = useMemo(
    () => shuffled(data?.results.filter((m) => m.backdrop_path && m.media_type !== 'person') ?? []).slice(0, 8),
    [data],
  )
  return (
    <PosterWall
      label="热门推荐"
      backdrops={slides.map((m) => m.backdrop_path!)}
      info={(i) => (slides[i] ? <Info key={slides[i].id} m={slides[i]} /> : <Fallback error={error} />)}
    >
      {children}
    </PosterWall>
  )
}

function Info({ m }: { m: Media }) {
  const { ready, logo } = useLogo(m)
  // wait for the logo lookup so the plain title doesn't flash first
  if (!ready) return null
  return (
    <div className="max-w-2xl animate-in duration-700 fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
      <Title m={m} logo={logo} />
      <Ratings m={m}>
        <span>{m.media_type === 'tv' ? '剧集' : '电影'}</span>
        <span>{releaseOf(m)}</span>
      </Ratings>
      {m.overview && (
        <p className="mt-4 line-clamp-2 max-w-xl text-[15px] leading-7 text-foreground/80 md:line-clamp-3">
          {m.overview}
        </p>
      )}
    </div>
  )
}

function Fallback({ error }: { error?: string }) {
  if (!error) return <div />
  return (
    <div className="pointer-events-auto max-w-xl">
      <h2 className="font-heading text-4xl font-black md:text-5xl">热门作品会在这里轮播</h2>
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
        <p className="min-w-48 flex-1">连接 Emby 服务器后，没看完的作品会排在这里，点一下就能接着看。</p>
        <Button asChild variant="secondary" size="sm">
          <Link to="/library">去媒体库</Link>
        </Button>
      </div>
    </section>
  )
}
