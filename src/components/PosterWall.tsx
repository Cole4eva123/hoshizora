import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type Logo, type Media, img, isDarkInk, originalTitleOf, titleOf } from '@/lib/tmdb'
import { cn } from '@/lib/utils'

const scrollToSlide = (el: HTMLElement | null, i: number) => el?.scrollTo({ left: i * el.clientWidth })

// TMDB's image host allows cross-origin reads, so a loaded logo can be sampled on a small canvas.
const isDark = (logo: HTMLImageElement) => {
  try {
    const c = Object.assign(document.createElement('canvas'), { width: 48, height: 16 })
    const g = c.getContext('2d')!
    g.drawImage(logo, 0, 0, c.width, c.height)
    return isDarkInk(g.getImageData(0, 0, c.width, c.height).data)
  } catch {
    return false // unreadable canvas: show the logo as it is
  }
}

// The title in its own lettering when TMDB has a logo, else in our serif. Under a logo in another language goes
// the Chinese name; otherwise the original name goes there, as with the text title.
export function Title({ m, logo, as: Heading = 'h2' }: { m: Media; logo?: Logo; as?: 'h1' | 'h2' }) {
  const [tone, setTone] = useState<'light' | 'dark' | 'broken'>()
  const title = titleOf(m)
  const original = originalTitleOf(m)
  const art = tone !== 'broken' && logo
  return (
    <>
      {art ? (
        <Heading>
          <img
            src={img(art.file_path, 'w500')}
            srcSet={`${img(art.file_path, 'w1280')} 2x`}
            alt={title}
            crossOrigin="anonymous"
            onLoad={(e) => setTone(isDark(e.currentTarget) ? 'dark' : 'light')}
            onError={() => setTone('broken')}
            className={cn(
              'max-h-20 max-w-[min(100%,32rem)] transition-opacity md:max-h-28',
              !tone && 'opacity-0',
              tone === 'dark' && 'brightness-0 invert',
            )}
          />
        </Heading>
      ) : (
        <Heading className="line-clamp-2 font-heading text-4xl leading-tight font-black text-balance md:text-6xl">
          {title}
        </Heading>
      )}
      {original !== title && (
        <p className="mt-2 text-sm text-foreground/60">{art && art.iso_639_1 !== 'zh' ? title : original}</p>
      )}
    </>
  )
}

// A full-screen, swipeable wall of backdrops. `info` describes the current slide over its lower left,
// and `children` sit on its lower edge, with the wall running past the fold so only about their top half
// shows on the first screen (posters grow with the screen width, hence vw).
export function PosterWall({
  label,
  backdrops,
  info,
  children,
}: {
  label: string
  backdrops: string[]
  info: (index: number) => ReactNode
  children?: ReactNode
}) {
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const current = backdrops[index]

  // Swiping changes `index`, which restarts the timer.
  useEffect(() => {
    if (paused || backdrops.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => scrollToSlide(track.current, (index + 1) % backdrops.length), 8000)
    return () => clearTimeout(t)
  }, [index, paused, backdrops.length])

  return (
    <section
      aria-label={label}
      className={cn(
        'relative flex flex-col justify-end pb-6',
        children ? 'min-h-[calc(100svh+30vw)] md:min-h-[calc(100svh+15vw)]' : 'min-h-svh',
      )}
    >
      {current && (
        // The current backdrop, blurred, stays behind the whole page.
        <img
          key={current}
          src={img(current, 'w300')}
          alt=""
          className="pointer-events-none fixed inset-0 -z-10 size-full scale-110 animate-in object-cover opacity-30 blur-3xl duration-1000 fade-in"
        />
      )}
      <div
        ref={track}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="no-scrollbar absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth mask-b-from-45% motion-reduce:scroll-auto"
      >
        {backdrops.map((path, i) => (
          <img
            key={path}
            src={img(path, 'w1280')}
            alt=""
            loading={i ? 'lazy' : 'eager'}
            className="size-full shrink-0 snap-start object-cover"
          />
        ))}
      </div>
      {/* Fades out at the bottom so the page below doesn't start at a visible edge. */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-background/90 via-background/30 to-transparent mask-b-from-75%" />

      <div className="pointer-events-none relative mb-8 flex flex-wrap items-end justify-between gap-6 px-(--gutter)">
        {info(index)}
        {backdrops.length > 1 && (
          <div className="pointer-events-auto flex items-center gap-2">
            {backdrops.map((path, i) => (
              <button
                key={path}
                aria-label={`第 ${i + 1} 张`}
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
      {children && <div className="relative">{children}</div>}
    </section>
  )
}
