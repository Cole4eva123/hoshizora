import { useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { BackButton, Page, sectionTitle } from '@/components/Page'
import { Frame, PosterCard, posterGrid } from '@/components/PosterRow'
import { useT } from '@/lib/i18n'
import { img, lifeOf, lineupOf, usePerson } from '@/lib/tmdb'
import { cn } from '@/lib/utils'

// An actor's page, opened from the cast of a title: who they are, then the 作品 they acted in.
export default function Person() {
  const t = useT()
  const { id } = useParams()
  const { person, works, error } = usePerson(id!)

  if (error)
    return (
      <Page title={t('打不开这位演员', "Can't load this actor")} back>
        <p className="text-sm text-muted-foreground">{error}</p>
      </Page>
    )
  if (!person || !works) return <BackButton /> // the way back is there before the person arrives
  const from = { lineup: lineupOf(works) }

  return (
    <Page title={person.name} back>
      {/* The facts sit beside the portrait; the biography goes under both on a phone, and beside the portrait,
          under the facts, on a wider screen. */}
      <div className="grid grid-cols-[7rem_1fr] items-start gap-x-5 gap-y-6 md:grid-cols-[11rem_1fr] md:grid-rows-[auto_1fr] md:gap-x-10 md:gap-y-4">
        {/* uncropped, like the cast row's headshot, which grows into this one (view transition "portrait") */}
        <Frame
          src={img(person.profile_path, 'w500')}
          className="aspect-2/3 text-5xl [view-transition-name:portrait] md:row-span-2"
        >
          {person.name.slice(0, 1)}
        </Frame>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {lifeOf(person, t).map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
        {person.biography && <Biography text={person.biography} />}
      </div>

      <section className="mt-14 md:mt-16">
        <h2 className={sectionTitle}>{t('作品', 'Filmography')}</h2>
        {/* ponytail: every 作品 mounts at once, a few hundred cards for the busiest actors; show a first batch and a
            更多 button if that ever feels slow */}
        {works.length ? (
          <div className={cn(posterGrid, 'mt-5')}>
            {works.map((w) => (
              <PosterCard key={w.media_type + w.id} m={w} role={w.character} from={from} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('TMDB 上还没有这位演员的作品。', 'TMDB has no roles listed for this actor yet.')}
          </p>
        )}
      </section>
    </Page>
  )
}

// Folded to five lines when it runs longer, with a button that unfolds the rest.
function Biography({ text }: { text: string }) {
  const t = useT()
  const ref = useRef<HTMLParagraphElement>(null)
  const [folds, setFolds] = useState(false)
  const [open, setOpen] = useState(false)
  // measured again when its width changes (a phone turned upright, a narrower window), which changes its line count,
  // and when the text does (the other language)
  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setFolds(el.scrollHeight > el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])
  return (
    <div className="col-span-2 max-w-2xl md:col-span-1">
      <p
        ref={ref}
        className={cn('text-[15px] leading-7 whitespace-pre-line text-foreground/80', !open && 'line-clamp-5')}
      >
        {text}
      </p>
      {folds && !open && (
        <button onClick={() => setOpen(true)} className="mt-2 rounded-sm text-sm text-primary hover:underline">
          {t('展开', 'Read more')}
        </button>
      )}
    </div>
  )
}
