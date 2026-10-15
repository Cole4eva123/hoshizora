import { type ReactNode, useMemo } from 'react'
import { Link } from 'react-router'
import { ContinueWatching } from '@/components/ContinueWatching'
import { EmptyState, ToLibrary } from '@/components/Page'
import { PosterRow } from '@/components/PosterRow'
import { PosterWall, TitleInfo } from '@/components/PosterWall'
import { useServers } from '@/lib/emby'
import { useT } from '@/lib/i18n'
import { useKey } from '@/lib/keys'
import { categories, hrefOf, lineupOf, titleOf, trendingToday, useTitles, wallSlides } from '@/lib/tmdb'

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

// 首页：最上面是画报墙，下面一行行是各个分类
export default function Home() {
  // 有自己的文案（h1），所以自己调 useT，切换语言时重绘
  const t = useT()
  // 解构：first 是第一个分类（热门电影），rest 是剩下的分类组成的数组
  const [first, ...rest] = categories
  return (
    // <>…</> 是 Fragment：把几个元素包成一个返回，不多出一层 DOM
    <>
      {/* sr-only：屏幕上看不见，读屏软件能读到；页面要有一个 h1 说明这是哪页 */}
      <h1 className="sr-only">{t('首页', 'Home')}</h1>
      {/* 第一个分类当 children 传给画报墙，压在画报墙的下沿上，第一屏就能看到 */}
      <TrendingWall>
        <PosterRow category={first} />
      </TrendingWall>
      {/* 画报墙下面的部分。Tailwind 的数字 × 4px 就是实际距离：
          space-y-4：每两个相邻子元素（继续观看、各分类行）之间隔 16px，加在父元素上，所有行一起变；手机和宽屏一样
          pb-(--page-bottom)：下内边距，用 index.css 里的 --page-bottom（至少 64px，iPhone 底部横条更高时取横条高度），
            最后一行不会贴着屏幕底 */}
      <div className="space-y-4 pb-(--page-bottom)">
        {/* 继续观看：所有服务器的合在一起，每张卡标出是哪台服务器的；还没连服务器时，说去哪连 */}
        <Resuming />
        {/* 其余分类每个一行；key 让 React 认出哪行是哪个分类 */}
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
  const slides = useMemo(() => shuffled(titles?.filter((m) => m.backdrop_path) ?? []).slice(0, wallSlides), [titles])
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
              <p className="mt-4 line-clamp-2 max-w-xl text-body leading-7 text-foreground/80 md:line-clamp-3">
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
  const token = useKey('tmdb')
  if (!error) return null
  return (
    <div className="pointer-events-auto max-w-xl">
      <h2 className="font-heading text-4xl font-extrabold md:text-5xl">
        {t('热门作品会在这里轮播', 'Trending titles take turns here')}
      </h2>
      <p className="mt-4 text-body leading-7 text-foreground/75">
        {token ? (
          error
        ) : (
          <>
            {t('还没有 TMDB 令牌，', 'No TMDB token yet, ')}
            <Link to="/settings" viewTransition className="text-star underline-offset-4 hover:underline">
              {t('到设置里填一个', 'put one in Settings')}
            </Link>
            {t('。', '.')}
          </>
        )}
      </p>
    </div>
  )
}

// Every server's 继续观看, each card naming its server; before any is connected, where to connect one.
function Resuming() {
  const t = useT()
  const servers = useServers()
  if (servers.length) return <ContinueWatching servers={servers} named />
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
