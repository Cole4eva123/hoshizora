import { type ReactNode, useMemo } from 'react'
import { EmptyState, ToLibrary } from '@/components/Page'
import { PosterRow } from '@/components/PosterRow'
import { PosterWall, TitleInfo } from '@/components/PosterWall'
import { useT } from '@/lib/i18n'
import { categories, hasToken, hrefOf, lineupOf, titleOf, trendingToday, useTitles } from '@/lib/tmdb'

// 打乱数组顺序，返回新数组，原数组不变（画报墙每次进首页轮播的顺序都不一样）
// <T,>：泛型，什么类型的数组都能打乱；逗号让 .tsx 不把 <T> 当成 JSX 标签
const shuffled = <T,>(list: T[]) =>
  list
    // 给每个元素配一个随机数：x → [0.73, x]；as const 让 TS 知道它是固定的两元组
    .map((x) => [Math.random(), x] as const)
    // 按随机数从小到大排，元素的顺序就被打乱了
    .sort((a, b) => a[0] - b[0])
    // 扔掉随机数，只留元素：[0.73, x] → x（[, x] 跳过第一个）
    .map(([, x]) => x)

export default function Home() {
  const t = useT()
  const [first, ...rest] = categories
  return (
    <>
      <h1 className="sr-only">{t('首页', 'Home')}</h1>
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
  const t = useT()
  const { titles, error } = useTitles(trendingToday)
  const slides = useMemo(() => shuffled(titles?.filter((m) => m.backdrop_path) ?? []).slice(0, 8), [titles])
  const lineup = lineupOf(slides)
  return (
    <PosterWall
      label={t('热门推荐', 'Trending')}
      backdrops={slides.map((m) => m.backdrop_path!)}
      link={(i) => ({ to: hrefOf(slides[i]), label: titleOf(slides[i]), state: { lineup } })}
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
  const t = useT()
  if (!error) return null
  return (
    <div className="pointer-events-auto max-w-xl">
      <h2 className="font-heading text-4xl font-black md:text-5xl">
        {t('热门作品会在这里轮播', 'Trending titles take turns here')}
      </h2>
      <p className="mt-4 text-[15px] leading-7 text-foreground/75">
        {hasToken
          ? error
          : t(
              <>
                还没有配置 TMDB 令牌。在项目根目录新建 <code>.env.local</code>，写入{' '}
                <code>VITE_TMDB_TOKEN=你的读访问令牌</code>，然后重启 <code>bun run dev</code>。
              </>,
              <>
                No TMDB token yet. Create <code>.env.local</code> in the project root with{' '}
                <code>VITE_TMDB_TOKEN=your read access token</code>, then restart <code>bun run dev</code>.
              </>,
            )}
      </p>
    </div>
  )
}

function ContinueWatching() {
  const t = useT()
  return (
    <section className="px-(--gutter)">
      <EmptyState title={t('继续观看', 'Continue Watching')}>
        {t(
          <>
            连接 Emby 服务器后，没看完的作品会排在这里，点一下就能接着看。先去
            <ToLibrary />
            连接服务器。
          </>,
          <>
            Once an Emby server is connected, what you haven't finished lines up here, one click from where you left
            off. Connect a server in <ToLibrary /> first.
          </>,
        )}
      </EmptyState>
    </section>
  )
}
