import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Choices } from '@/components/Choices'
import { Constellation, type Star } from '@/components/Constellation'
import { sectionTitle, ToLibrary } from '@/components/Page'
import { Frame, PosterGrid } from '@/components/PosterRow'
import { TitleInfo } from '@/components/PosterWall'
import { type Translate, useT } from '@/lib/i18n'
import { type From, type Media, hrefOf, img, lineupOf, searchPath, titleOf, trendingToday, useTitles } from '@/lib/tmdb'
import { cn, lens, server, usePages } from '@/lib/utils'

// The constellations of the 搜索范围, like the corner menu's: a rack of servers, a bucket of popcorn for TMDB's 作品,
// and `server`, shared with the 媒体库.
const rack: Star[][] = [[[3, 3], [21, 3], [21, 21], [3, 21], [3, 3]], [[3, 12], [21, 12]], [[7, 7.5]], [[7, 16.5]]]
const popcorn: Star[][] = [
  [[5, 9], [7, 5], [10, 6.5], [12, 3.5], [14, 6.5], [17, 5], [19, 9], [17, 21], [7, 21], [5, 9]],
  [[5, 9], [19, 9]],
]

// Each 搜索范围 has its own colour (--tone): its star when picked, and the field's lens, caret and line.
const scopesIn = (t: Translate) => [
  {
    key: 'all',
    label: t('全部服务器', 'All servers'),
    icon: rack,
    tone: '[--tone:var(--primary)]',
    placeholder: t('在所有服务器里找作品', 'Search all your servers'),
    empty: t(
      <>还没有可搜索的服务器。先去<ToLibrary />连接 Emby 服务器，这里会一次搜遍所有服务器。</>,
      <>No servers to search yet. Connect an Emby server in <ToLibrary />, and this searches all of them at once.</>,
    ),
  },
  {
    key: 'tmdb',
    label: 'TMDB',
    icon: popcorn,
    tone: '[--tone:var(--tmdb)]',
    placeholder: t('在 TMDB 上找作品', 'Search TMDB'),
  },
  {
    key: 'server',
    label: t('指定服务器', 'One server'),
    icon: server,
    tone: '[--tone:var(--apricot)]',
    placeholder: t('在这台服务器里找作品', 'Search this server'),
    empty: t(
      <>还没有可选的服务器。先去<ToLibrary />连接 Emby 服务器，再挑一台单独搜索。</>,
      <>No servers to pick yet. Connect an Emby server in <ToLibrary />, then pick one to search.</>,
    ),
  },
]

// The scope and the query live in the URL, so coming back from a title brings back the same results.
export default function Search() {
  const t = useT()
  const scopes = scopesIn(t)
  const [params, setParams] = useSearchParams()
  // ponytail: TMDB is the default while no Emby server can be connected; make it 全部服务器 once one can
  const scope = scopes.find((s) => s.key === params.get('scope')) ?? scopes.find((s) => s.key === 'tmdb')!
  const q = params.get('q') ?? ''

  // What's typed is searched once typing pauses, and Chinese once the IME commits it, not while it's still pinyin.
  const [typed, setTyped] = useState(q)
  useEffect(() => {
    const text = typed.trim()
    if (text === q) return
    const timer = setTimeout(() => setParams({ scope: scope.key, q: text }, { replace: true }), 300)
    return () => clearTimeout(timer)
  }, [typed, q, scope.key, setParams])

  return (
    // starts where other pages' titles do, clear of the corner menu
    <div className={cn('px-(--gutter) pt-(--page-top) pb-(--page-bottom)', scope.tone)}>
      <h1 className="sr-only">{t('搜索', 'Search')}</h1>
      {/* One line across the top: the lens, what's typed, and the scopes at its end (on a phone, under it). Enter, or
          the keyboard's 搜索 key, puts the keyboard away so the results show. */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          ;(document.activeElement as HTMLElement).blur()
        }}
        className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-star/15 pb-3 transition-colors has-[input:focus]:border-tone"
      >
        <Constellation lines={lens} className="size-6 text-tone" />
        {/* what's typed is set like a title, in the headings' extrabold. While the placeholder shows, the field takes
            its smaller regular type, else the placeholder would sit on the title's baseline, below the middle */}
        <input
          type="search"
          defaultValue={q}
          autoFocus={!q}
          onChange={(e) => {
            if (!(e.nativeEvent as InputEvent).isComposing) setTyped(e.target.value)
          }}
          onCompositionEnd={(e) => setTyped(e.currentTarget.value)}
          placeholder={scope.placeholder}
          aria-label={scope.placeholder}
          className="h-9 min-w-0 grow basis-48 bg-transparent font-heading text-2xl font-extrabold caret-tone outline-none placeholder-shown:text-lg placeholder-shown:font-normal placeholder:text-muted-foreground sm:basis-64 md:h-10 md:text-3xl"
        />
        <Choices
          legend={t('搜索范围', 'Search in')}
          options={scopes}
          value={scope.key}
          // at once, as a 分类's sorts are, so a quick press on the next scope isn't lost
          onChange={(key) => setParams({ scope: key, q: typed.trim() }, { replace: true, flushSync: true })}
          className="max-sm:w-full"
        />
      </form>

      {scope.empty ? (
        <p className="mt-6 max-w-md text-body leading-7 text-muted-foreground">{scope.empty}</p>
      ) : q ? (
        <Found q={q} />
      ) : (
        // nothing asked yet: what's being watched today, rather than an empty sky
        <section className="mt-10">
          <h2 className={cn(sectionTitle, 'mb-6')}>{t('今天大家在看', 'Trending today')}</h2>
          <PosterGrid path={trendingToday} />
        </section>
      )}
    </div>
  )
}

// What a search found: the best match on a wide 剧照 when it has one, then the rest in the grid, whose pages these are
// too (asked for once). Stepping on from either goes through the same list, the best match first.
function Found({ q }: { q: string }) {
  const path = searchPath(q)
  const pages = usePages()
  const { titles, error } = useTitles(path, pages)
  const top = titles?.[0]?.backdrop_path ? titles[0] : undefined
  return (
    <>
      {top ? (
        <TopMatch key={hrefOf(top)} m={top} from={titles && { lineup: lineupOf(titles), list: { path, pages } }} />
      ) : (
        !titles && !error && <TopMatch />
      )}
      <div className="mt-10">
        <PosterGrid path={path} skip={top ? 1 : 0} />
      </div>
    </>
  )
}

// A 作品 on a wide 剧照, told as the 画报墙 tells it, with the start of its overview; without `m`, its place while the
// search is on its way. Pointing at it catches starlight on the frame, as on a poster.
function TopMatch({ m, from }: { m?: Media; from?: From }) {
  const frame = 'aspect-square max-h-112 w-full rounded-2xl sm:aspect-video lg:aspect-21/9'
  if (!m) return <Frame className={cn(frame, 'mt-8 animate-pulse')} />
  return (
    <Link to={hrefOf(m)} state={from} viewTransition aria-label={titleOf(m)} className="group relative mt-8 block">
      <Frame src={img(m.backdrop_path, 'backdrop')} className={cn(frame, 'transition group-hover:outline-star/60')} />
      <div className="absolute inset-0 flex items-end rounded-2xl bg-linear-to-tr from-background/90 via-background/30 to-transparent p-6 md:p-10">
        <TitleInfo m={m}>
          {m.overview && <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-6 text-foreground/80">{m.overview}</p>}
        </TitleInfo>
      </div>
    </Link>
  )
}
