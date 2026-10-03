import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type Category, type Media, img, titleOf, useTitles, yearOf } from '@/lib/tmdb'

// A picture in the cards' rounded frame. Without one, `children` (an episode number, an initial) fill the frame.
export function Frame({ src, className, children }: { src?: string; className: string; children?: ReactNode }) {
  return (
    <div
      className={cn(
        'grid place-items-center overflow-hidden rounded-lg bg-muted font-heading text-muted-foreground outline -outline-offset-1 outline-white/8',
        className,
      )}
    >
      {src ? <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" /> : children}
    </div>
  )
}

export function PosterCard({ m }: { m: Media }) {
  return (
    <Link to={`/${m.media_type}/${m.id}`} className="group snap-start">
      <Frame src={img(m.poster_path, 'w342')} className="aspect-2/3 transition-colors group-hover:outline-star/60" />
      <p className="mt-2 truncate text-sm">{titleOf(m)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{yearOf(m)}</p>
    </Link>
  )
}

export function PosterSkeleton({ pulse }: { pulse: boolean }) {
  return (
    <div className={cn(pulse && 'animate-pulse')}>
      <div className="aspect-2/3 rounded-lg bg-muted/70" />
      <div className="mt-2 h-4 w-3/4 rounded bg-muted/70" />
    </div>
  )
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

  // Jump to item `start` once it's known, e.g. the latest episode of a long season.
  useLayoutEffect(() => {
    const el = ref.current!
    const item = start === undefined ? undefined : (el.children[start] as HTMLElement | undefined)
    if (item) el.scrollTo({ left: item.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft), behavior: 'instant' })
  }, [start])

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
          <h2 className="text-lg font-semibold">{title}</h2>
          {extra}
        </div>
        <div className="hidden shrink-0 gap-1 pointer-fine:flex">
          <Button variant="ghost" size="icon" aria-label="上一页" onClick={() => page(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" aria-label="下一页" onClick={() => page(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div
        ref={ref}
        className={cn(
          'no-scrollbar relative mt-3 grid snap-x snap-mandatory scroll-px-(--gutter) grid-flow-col gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-(--gutter) motion-reduce:scroll-auto sm:gap-4',
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
        <Link to={`/category/${category.key}`} className="group inline-flex items-center gap-0.5">
          {category.title}
          <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      }
      track="auto-cols-[calc((100%-2*0.75rem)/3)] sm:auto-cols-[calc((100%-3*1rem)/4)] lg:auto-cols-[calc((100%-4*1rem)/5)] xl:auto-cols-[calc((100%-5*1rem)/6)]"
    >
      {titles
        ? titles.map((m) => <PosterCard key={m.id} m={m} />)
        : Array.from({ length: 6 }, (_, i) => <PosterSkeleton key={i} pulse={!error} />)}
    </Row>
  )
}
