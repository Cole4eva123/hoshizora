import { Children, type ReactNode, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { sectionTitle } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { cn, reveal } from '@/lib/utils'
import { type Category, type Media, img, titleOf, useTitles, yearOf } from '@/lib/tmdb'

// A picture in the cards' rounded frame. `children` (an episode number, an initial) sit under it, in the same grid
// cell: they show while it loads, if it fails, and when there's none.
export function Frame({ src, className, children }: { src?: string; className: string; children?: ReactNode }) {
  return (
    <div
      className={cn(
        'grid place-items-center overflow-hidden rounded-lg bg-muted font-heading text-muted-foreground outline -outline-offset-1 outline-white/8 *:[grid-area:1/1]',
        className,
      )}
    >
      <span>{children}</span>
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          ref={reveal}
          onLoad={(e) => reveal(e.currentTarget)}
          className="size-full object-cover opacity-0 transition-opacity duration-500 data-loaded:opacity-100"
        />
      )}
    </div>
  )
}

// Pointing at a card catches starlight on its frame and name; pressing it gives a little. `role`, on an actor's page,
// is the part they played in it.
export function PosterCard({ m, role }: { m: Media; role?: string }) {
  return (
    <Link to={`/${m.media_type}/${m.id}`} viewTransition className="group snap-start">
      <Frame
        src={img(m.poster_path, 'w342')}
        className="aspect-2/3 transition group-hover:outline-star/60 group-active:scale-[.97]"
      />
      <p className="mt-2.5 truncate text-sm transition-colors group-hover:text-star">{titleOf(m)}</p>
      <p className="mt-0.5 flex gap-x-2 text-xs text-muted-foreground">
        {yearOf(m)}
        {role && <span className="truncate">饰 {role}</span>}
      </p>
    </Link>
  )
}

// A grid of posters, as many to a line as the home rows show on a screen.
export const posterGrid = 'grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-4 sm:gap-y-8 lg:grid-cols-5 xl:grid-cols-6'

// `n` placeholder cards while titles load; they stop pulsing once loading has failed.
export function PosterSkeletons({ n, pulse }: { n: number; pulse: boolean }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className={cn(pulse && 'animate-pulse')}>
      <div className="aspect-2/3 rounded-lg bg-muted/70" />
      <div className="mt-2.5 h-4 w-3/4 rounded bg-muted/70" />
    </div>
  ))
}

// A titled, horizontally scrolling row. `track` sets how wide its items are and `extra` sits under the title.
export function Row({
  title,
  extra,
  track,
  start,
  children,
}: {
  title: ReactNode
  extra?: ReactNode
  track: string
  start?: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // the items' keys: a new list, like another season's episodes, has other keys
  const items = Children.map(children, (c) => (isValidElement(c) ? c.key : null))?.join(' ')
  // Whether the row is scrolled to its start and to its end, where the paging buttons have nowhere to go. Booleans, so
  // the scroll events that change neither don't render the row again.
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  const measure = () => {
    const el = ref.current!
    setAtStart(el.scrollLeft < 1)
    setAtEnd(el.scrollLeft + el.clientWidth > el.scrollWidth - 1)
  }

  // Jump to item `start` whenever a new list arrives, e.g. the latest aired episode of the season just picked.
  useLayoutEffect(() => {
    const el = ref.current!
    const item = start === undefined ? undefined : (el.children[start] as HTMLElement | undefined)
    if (item) el.scrollTo({ left: item.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft), behavior: 'instant' })
    measure() // a new list changes how far the row scrolls, without firing onScroll or the ResizeObserver
  }, [start, items])
  // a row made wider or narrower can lose or gain its overflow
  useEffect(() => {
    const ro = new ResizeObserver(measure)
    ro.observe(ref.current!)
    return () => ro.disconnect()
  }, [])

  // One click moves exactly one screenful of items.
  const page = (dir: 1 | -1) => {
    const el = ref.current!
    const s = getComputedStyle(el)
    el.scrollBy({ left: dir * (el.clientWidth - 2 * parseFloat(s.paddingLeft) + parseFloat(s.columnGap)) })
  }

  return (
    <section>
      <div className="flex items-end justify-between gap-4 px-(--gutter)">
        <div className="min-w-0">
          <h2 className={sectionTitle}>{title}</h2>
          {extra}
        </div>
        {/* aria-disabled, not disabled, which would drop keyboard focus at the row's end; a click there scrolls nowhere */}
        <div className="hidden shrink-0 gap-1 pointer-fine:flex *:aria-disabled:pointer-events-none *:aria-disabled:opacity-50">
          <Button variant="ghost" size="icon" aria-label="上一页" aria-disabled={atStart} onClick={() => page(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" aria-label="下一页" aria-disabled={atEnd} onClick={() => page(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div
        ref={ref}
        onScroll={measure}
        className={cn(
          'no-scrollbar relative mt-4 grid snap-x snap-mandatory scroll-px-(--gutter) grid-flow-col gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-(--gutter) motion-reduce:scroll-auto sm:gap-4',
          track,
        )}
      >
        {children}
      </div>
    </section>
  )
}

export function PosterRow({ category }: { category: Category }) {
  const { titles, error } = useTitles(category.path)
  return (
    <Row
      title={
        <Link
          to={`/category/${category.key}`}
          viewTransition
          className="group inline-flex items-center gap-1 transition-colors hover:text-star"
        >
          {category.title}
          <ChevronRight className="size-5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-star" />
        </Link>
      }
      track="auto-cols-[calc((100%-2*0.75rem)/3)] sm:auto-cols-[calc((100%-3*1rem)/4)] lg:auto-cols-[calc((100%-4*1rem)/5)] xl:auto-cols-[calc((100%-5*1rem)/6)]"
    >
      {titles ? titles.map((m) => <PosterCard key={m.id} m={m} />) : <PosterSkeletons n={6} pulse={!error} />}
    </Row>
  )
}

// A list's 作品 as a grid that loads on as you scroll, for a 分类 or a search. The pages shown live in the URL
// (?pages=N), so coming back from a title brings back as many as there were, and the scroll position with them.
export function PosterGrid({ path }: { path: string }) {
  const [params, setParams] = useSearchParams()
  const pages = Math.max(1, Math.floor(Number(params.get('pages'))) || 1)
  const { titles, loading, more, error, retry } = useTitles(path, pages)
  const end = useRef<HTMLDivElement>(null)

  // Ask for the next page about two screens before the end shows. Each page gets a fresh observer, which reports at
  // once if the end is still in range, as on a tall screen.
  useEffect(() => {
    if (loading || error || !more) return
    const next = (p: URLSearchParams) => {
      p.set('pages', String(pages + 1))
      return p
    }
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setParams(next, { replace: true, preventScrollReset: true }),
      { rootMargin: '0px 0px 200% 0px' },
    )
    io.observe(end.current!)
    return () => io.disconnect()
  }, [loading, error, more, pages, setParams])

  // ponytail: every card stays in the DOM, about five nodes each (908 in all at 180 titles). content-visibility:auto was
  // tried and dropped: a remounted page gets placeholder heights, so on phones back navigation lands rows off. Window
  // the grid by rows (TanStack Virtual) if lists ever run to thousands.
  return (
    <>
      <div className={posterGrid}>
        {titles?.map((m) => <PosterCard key={m.id} m={m} />)}
        {loading && <PosterSkeletons n={titles ? 6 : 12} pulse={!error} />}
      </div>
      <div ref={end} />
      <p className="sr-only" aria-live="polite">
        {titles && `已加载 ${titles.length} 部`}
      </p>
      {error ? (
        <p className="mt-8 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {error}
          <Button variant="secondary" size="sm" onClick={retry}>
            重试
          </Button>
        </p>
      ) : (
        titles &&
        !loading &&
        !more && (
          <p className="mt-10 text-center text-sm text-muted-foreground">{titles.length ? '没有更多了' : '没有找到作品'}</p>
        )
      )}
    </>
  )
}
