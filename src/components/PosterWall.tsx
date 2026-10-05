import { Fragment, type ReactNode, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Pause, Play } from 'lucide-react'
import { Ratings } from '@/components/Ratings'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { type Logo, type Media, img, isDarkInk, originalTitleOf, releaseOf, titleOf, useLogo } from '@/lib/tmdb'
import { cn, reveal } from '@/lib/utils'

const scrollToSlide = (el: HTMLElement | null, i: number) => el?.scrollTo({ left: i * el.clientWidth })

// TMDB's image host allows cross-origin reads, so loaded 片名艺术字 can be sampled on a small canvas.
const isDark = (logo: HTMLImageElement) => {
  try {
    const c = Object.assign(document.createElement('canvas'), { width: 48, height: 16 })
    const g = c.getContext('2d')!
    g.drawImage(logo, 0, 0, c.width, c.height)
    return isDarkInk(g.getImageData(0, 0, c.width, c.height).data)
  } catch {
    return false // unreadable canvas: show the lettering as it is
  }
}

// The title in its 片名艺术字 when TMDB has some, else in our serif. Under lettering in another language goes the
// name in the language shown; otherwise the original name goes there, as with the text title.
function Title({ m, logo, as: Heading = 'h2' }: { m: Media; logo?: Logo; as?: 'h1' | 'h2' }) {
  const t = useT()
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
        <p className="mt-2 text-sm text-foreground/60">{art && art.iso_639_1 !== t('zh', 'en') ? title : original}</p>
      )}
    </>
  )
}

// What the wall says about a title, over its lower left: the name, the scores with its type, date and `facts`, then
// `children`. Held back until the 片名艺术字 lookup is done, so the plain title doesn't flash first. Keyed by the
// title, so the next one fades in afresh and doesn't inherit this one's lettering state.
export function TitleInfo({
  m,
  as,
  facts = [],
  children,
}: {
  m: Media
  as?: 'h1' | 'h2'
  facts?: string[]
  children?: ReactNode
}) {
  const t = useT()
  const { ready, logo } = useLogo(m)
  if (!ready) return null
  return (
    <div
      key={`${m.media_type}/${m.id}`}
      className="max-w-2xl animate-in duration-700 fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
    >
      {/* keyed by its lettering: the other language's starts afresh, not with this one's tone */}
      <Title key={logo?.file_path} m={m} logo={logo} as={as} />
      <Ratings m={m}>
        {[m.media_type === 'tv' ? t('剧集', 'Series') : t('电影', 'Movie'), releaseOf(m, t), ...facts]
          .filter(Boolean)
          .map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
      </Ratings>
      {children}
    </div>
  )
}

// A full-screen, swipeable wall of backdrops. `info` describes the current slide over its lower left,
// and `children` sit on its lower edge, with the wall running past the fold so only about their top half
// shows on the first screen (posters grow with the screen width, hence vw). With `link`, each slide is a link: where
// it leads, and its name for screen readers. `info` lets clicks through, so a click on the title opens it too.
export function PosterWall({
  label,
  backdrops,
  info,
  link,
  children,
}: {
  label: string
  backdrops: string[]
  info: (index: number) => ReactNode
  link?: (index: number) => { to: string; label: string }
  children?: ReactNode
}) {
  const t = useT()
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const current = backdrops[index]

  return (
    <section
      aria-label={label}
      className={cn(
        'relative flex flex-col justify-end pb-6',
        children ? 'min-h-[calc(100svh+30vw)] md:min-h-[calc(100svh+15vw)]' : 'min-h-svh',
      )}
    >
      {current && (
        // The current backdrop, blurred, tints the whole page faintly; the night sky stays the base.
        <img
          key={current}
          src={img(current, 'w300')}
          alt=""
          className="pointer-events-none fixed inset-0 -z-10 size-full scale-110 animate-in object-cover opacity-12 blur-3xl duration-1000 fade-in"
        />
      )}
      {/* In landscape the backdrops keep their own 16:9 frame at full width, so none of the still is cropped; the
          wall below them shows the blurred copy. In portrait they cover the whole wall, as a 16:9 strip would be tiny. */}
      <div
        ref={track}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="no-scrollbar recede absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth mask-b-from-45% motion-reduce:scroll-auto landscape:bottom-auto landscape:aspect-video landscape:max-h-full landscape:mask-b-from-75%"
      >
        {backdrops.map((path, i) => {
          const still = (
            <img
              src={img(path, 'w1280')}
              alt=""
              loading={i ? 'lazy' : 'eager'}
              ref={reveal}
              onLoad={(e) => reveal(e.currentTarget)}
              className="size-full object-cover opacity-0 transition-opacity duration-700 data-loaded:opacity-100"
            />
          )
          const to = link?.(i)
          // inset focus ring: the track's overflow would clip one drawn outside the slide
          return to ? (
            <Link
              key={path}
              to={to.to}
              viewTransition
              aria-label={to.label}
              className="size-full shrink-0 snap-start -outline-offset-2"
            >
              {still}
            </Link>
          ) : (
            <div key={path} className="size-full shrink-0 snap-start">
              {still}
            </div>
          )
        })}
      </div>
      {/* Darkest under the title in the lower left, clear toward the upper right; fades out at the bottom so the
          page below doesn't start at a visible edge. A shade along the top keeps the corner menu legible on a bright
          still. */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-tr from-background/90 via-background/30 to-transparent mask-b-from-75% before:absolute before:inset-x-0 before:top-0 before:h-36 before:bg-linear-to-b before:from-background/60" />

      <div className="pointer-events-none relative mb-8 flex flex-wrap items-end justify-between gap-6 px-(--gutter)">
        {info(index)}
        {backdrops.length > 1 && (
          // The slides as a constellation, like the logo: a star each, the current one lit, the lines up to it drawn.
          // The line after it draws itself (animate-draw, the slide's time on screen) and on reaching the next star
          // brings that slide in; the last one's runs to the pause button. It loops, so if the slide doesn't change (a
          // finger was dragging the wall) the next round tries again. Pausing holds the line where it is. With
          // reduced motion there's no line, and so no autoplay. A blurred patch of night behind keeps it visible on a
          // bright still; it reaches out less than the narrowest gutter, or the page would scroll sideways on phones.
          // ml-auto keeps it on the right while the title is held back and it's the row's only item.
          <div className="pointer-events-auto relative isolate ml-auto flex items-center before:absolute before:-inset-x-4 before:-inset-y-4 before:-z-10 before:rounded-full before:bg-night/50 before:blur-xl">
            {backdrops.map((path, i) => (
              <Fragment key={path}>
                <button
                  aria-label={t(`第 ${i + 1} 张`, `Slide ${i + 1}`)}
                  aria-current={i === index}
                  onClick={() => scrollToSlide(track.current, i)}
                  className={cn(
                    'grid size-5 place-items-center rounded-full after:size-1.5 after:rounded-full after:transition',
                    i === index
                      ? 'after:scale-125 after:bg-star after:shadow-[0_0_8px_2px_var(--glow)]'
                      : 'after:bg-foreground/50 hover:after:bg-foreground/90',
                  )}
                />
                {/* with reduced motion the last line, which leads to the hidden pause button, goes too */}
                <span
                  className={cn(
                    'h-px w-3 motion-reduce:last-of-type:hidden sm:w-5',
                    i < index ? 'bg-star/60' : 'bg-foreground/25',
                  )}
                >
                  {i === index && (
                    <span
                      onAnimationIteration={() => scrollToSlide(track.current, (i + 1) % backdrops.length)}
                      className={cn(
                        'block h-full origin-left animate-draw bg-star motion-reduce:hidden',
                        paused && '[animation-play-state:paused]',
                      )}
                    />
                  )}
                </span>
              </Fragment>
            ))}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={paused ? t('继续轮播', 'Resume slideshow') : t('暂停轮播', 'Pause slideshow')}
              onClick={() => setPaused(!paused)}
              className="motion-reduce:hidden"
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
