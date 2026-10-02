import { useRef } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type Category, type Media, type MediaList, img, titleOf, useTmdb, yearOf } from '@/lib/tmdb'

export function PosterCard({ m }: { m: Media }) {
  return (
    <figure className="snap-start">
      <div className="aspect-2/3 overflow-hidden rounded-lg bg-muted outline -outline-offset-1 outline-white/8">
        {m.poster_path && (
          <img src={img(m.poster_path, 'w342')} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        )}
      </div>
      <figcaption className="mt-2 truncate text-sm">{titleOf(m)}</figcaption>
      <p className="mt-0.5 text-xs text-muted-foreground">{yearOf(m)}</p>
    </figure>
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

export function PosterRow({ category }: { category: Category }) {
  const { data, error } = useTmdb<MediaList>(category.path)
  const track = useRef<HTMLDivElement>(null)

  // One click moves exactly one screenful of posters.
  const page = (dir: 1 | -1) => {
    const el = track.current!
    const s = getComputedStyle(el)
    el.scrollBy({ left: dir * (el.clientWidth - 2 * parseFloat(s.paddingLeft) + parseFloat(s.columnGap)) })
  }

  return (
    <section>
      <div className="flex items-center justify-between px-(--gutter)">
        <h2>
          <Link to={`/category/${category.key}`} className="group inline-flex items-center gap-0.5 text-lg font-semibold">
            {category.title}
            <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </h2>
        <div className="hidden gap-1 pointer-fine:flex">
          <Button variant="ghost" size="icon" aria-label="上一页" onClick={() => page(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" aria-label="下一页" onClick={() => page(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div
        ref={track}
        className="no-scrollbar mt-3 grid snap-x snap-mandatory scroll-px-(--gutter) auto-cols-[calc((100%-2*0.75rem)/3)] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-(--gutter) motion-reduce:scroll-auto sm:auto-cols-[calc((100%-3*1rem)/4)] sm:gap-4 lg:auto-cols-[calc((100%-4*1rem)/5)] xl:auto-cols-[calc((100%-5*1rem)/6)]"
      >
        {data
          ? data.results.map((m) => <PosterCard key={m.id} m={m} />)
          : Array.from({ length: 6 }, (_, i) => <PosterSkeleton key={i} pulse={!error} />)}
      </div>
    </section>
  )
}
