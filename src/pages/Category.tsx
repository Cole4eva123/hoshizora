import { useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { ChevronDown } from 'lucide-react'
import { Choices } from '@/components/Choices'
import { Page } from '@/components/Page'
import { PosterGrid } from '@/components/PosterRow'
import { useT } from '@/lib/i18n'
import { categories, sortsOf, useGenres, withGenres } from '@/lib/tmdb'
import { choice, cn } from '@/lib/utils'

type Genre = ReturnType<typeof useGenres>[number]

// The sort and the 类型 live in the URL, like the pages PosterGrid has shown, so coming back from a title brings back
// the same list.
export default function Category() {
  const t = useT()
  const { key } = useParams()
  const [params, setParams] = useSearchParams()
  const category = categories.find((c) => c.key === key)
  const genres = useGenres(category)
  if (!category) return <Navigate to="/" replace />

  const sorts = sortsOf(category, t)
  const sort = sorts.find((s) => s.key === params.get('sort')) ?? sorts[0]
  // The 类型 picked, by id: the URL's at once, so the list is asked for without waiting for TMDB's names, then, once
  // they're in, only those the 分类 offers, so an old or edited link can't leave a pick that can't be unpicked.
  const asked = sort ? params.getAll('genre').map(Number) : []
  const ids = genres.length ? genres.filter((g) => asked.includes(g.key)).map((g) => g.key) : asked.filter(Boolean)
  const path = withGenres(sort?.path ?? category.path, ids)
  // a new sort or new 类型 start the list over from its first page, at the top, and keep the other. Each 类型 is a
  // ?genre= of its own, as a comma would show in the address bar as %2C.
  const choose = (name: 'sort' | 'genre', values: (string | number)[]) =>
    setParams(
      (p) => {
        p.delete(name)
        for (const v of values) p.append(name, `${v}`)
        p.delete('pages')
        return p
      },
      { replace: true },
    )

  return (
    <Page title={t(...category.title)} back>
      {sort && (
        <div className="mb-10">
          {/* the 类型 panel drops from this row, over the hint and the posters */}
          <div className="relative flex w-fit flex-wrap items-center gap-x-6 gap-y-2">
            <Choices
              legend={t('排序', 'Sort by')}
              options={sorts}
              value={sort.key}
              onChange={(s) => choose('sort', [s])}
            />
            {/* once TMDB's list is in, so the word comes already naming the picks and never unrolls an empty panel */}
            {genres.length > 0 && <Genres options={genres} ids={ids} onChange={(next) => choose('genre', next)} />}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{sort.hint}</p>
        </div>
      )}
      <PosterGrid path={path} />
    </Page>
  )
}

// All the 类型 don't fit in the row, so they sit behind one word at its end. Pointing at it unrolls them in CSS, like
// the corner menu; a tap or Enter opens them (`open`), as a phone has no hover, and a keyboard then tabs through them
// only when asked to. The word names the 类型 picked, starred like a picked sort.
function Genres({ options, ids, onChange }: { options: Genre[]; ids: number[]; onChange: (ids: number[]) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const names = options.filter((g) => ids.includes(g.key)).map((g) => g.label)
  return (
    <div
      data-open={open || undefined}
      onMouseLeave={() => setOpen(false)}
      // Tabbing out puts it away. A press on a 类型 moves focus to nothing (relatedTarget is null) and leaves it open,
      // else a phone would close it after each pick.
      onBlur={(e) => e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      className="group flex items-center gap-6"
    >
      {/* a constellation's line between the sorts and the 类型, as between the two languages */}
      <span aria-hidden="true" className="h-3.5 w-px rotate-20 bg-star/50" />
      <button
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(choice(ids.length > 0), 'flex items-center gap-1')}
      >
        {names.length ? (
          <>
            <span className="sr-only">{t('类型：', 'Genre: ')}</span>
            {names.join(t('、', ', '))}
          </>
        ) : (
          t('类型', 'Genre')
        )}
        <ChevronDown className="size-4" />
      </button>
      {/* anchored to the row, not the word, so it never runs off a phone's edge; at least as wide as the row, so the
          pointer can go straight down into it from the word */}
      <div className="invisible absolute top-full left-0 z-10 w-max max-w-[calc(100vw-2*var(--gutter))] min-w-full pt-3 opacity-0 transition-[opacity,visibility] group-hover:visible group-hover:opacity-100 group-data-open:visible group-data-open:opacity-100 motion-reduce:transition-none">
        {/* the corner menu's glass */}
        <Choices
          legend={t('类型', 'Genres')}
          options={options}
          value={ids}
          onChange={(id) => onChange(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id])}
          className="grid grid-cols-3 justify-items-start gap-x-6 gap-y-3 rounded-xl bg-night/80 p-5 inset-ring inset-ring-star/15 backdrop-blur-xl backdrop-saturate-150 sm:grid-cols-4"
        />
      </div>
    </div>
  )
}
