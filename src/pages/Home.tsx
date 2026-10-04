import { type ReactNode, useMemo } from 'react'
import { EmptyState, ToLibrary } from '@/components/Page'
import { PosterRow } from '@/components/PosterRow'
import { PosterWall, TitleInfo } from '@/components/PosterWall'
import { categories, hasToken, titleOf, trendingToday, useTitles } from '@/lib/tmdb'

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
      <div className="space-y-12 pt-6 pb-(--page-bottom) md:space-y-14">
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
  const { titles, error } = useTitles(trendingToday)
  const slides = useMemo(() => shuffled(titles?.filter((m) => m.backdrop_path) ?? []).slice(0, 8), [titles])
  return (
    <PosterWall
      label="热门推荐"
      backdrops={slides.map((m) => m.backdrop_path!)}
      link={(i) => ({ to: `/${slides[i].media_type}/${slides[i].id}`, label: titleOf(slides[i]) })}
      info={(i) =>
        slides[i] ? (
          <TitleInfo m={slides[i]}>
            {slides[i].overview && (
              <p className="mt-4 line-clamp-2 max-w-xl text-[15px] leading-7 text-foreground/80 md:line-clamp-3">
                {slides[i].overview}
              </p>
            )}
          </TitleInfo>
        ) : (
          <Fallback error={error} />
        )
      }
    >
      {children}
    </PosterWall>
  )
}

function Fallback({ error }: { error?: string }) {
  if (!error) return null
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
      <EmptyState title="继续观看">
        连接 Emby 服务器后，没看完的作品会排在这里，点一下就能接着看。先去
        <ToLibrary />
        连接服务器。
      </EmptyState>
    </section>
  )
}
