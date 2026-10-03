import { useEffect, useRef } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { Page } from '@/components/Page'
import { PosterCard, PosterSkeleton } from '@/components/PosterRow'
import { Button } from '@/components/ui/button'
import { type Category as CategoryType, categories, useTitles } from '@/lib/tmdb'

export default function Category() {
  const { key } = useParams()
  const category = categories.find((c) => c.key === key)
  return category ? <Grid key={category.key} category={category} /> : <Navigate to="/" replace />
}

const skeletons = (n: number, pulse: boolean) => Array.from({ length: n }, (_, i) => <PosterSkeleton key={i} pulse={pulse} />)

function Grid({ category }: { category: CategoryType }) {
  // The pages shown live in the URL, so coming back from a title brings them all back and the scroll position with them.
  const [params, setParams] = useSearchParams()
  const pages = Math.max(1, Math.floor(Number(params.get('pages'))) || 1)
  const { titles, loading, more, error, retry } = useTitles(category.path, pages)
  const end = useRef<HTMLDivElement>(null)

  // Ask for the next page about two screens before the end shows. Each page gets a fresh observer, which reports at
  // once if the end is still in range, as on a tall screen.
  useEffect(() => {
    if (loading || error || !more) return
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setParams({ pages: String(pages + 1) }, { replace: true, preventScrollReset: true }),
      { rootMargin: '0px 0px 200% 0px' },
    )
    io.observe(end.current!)
    return () => io.disconnect()
  }, [loading, error, more, pages, setParams])

  // ponytail: every card stays in the DOM, about five nodes each (908 in all at 180 titles). content-visibility:auto was
  // tried and dropped: a remounted page gets placeholder heights, so on phones back navigation lands rows off. Window
  // the grid by rows (TanStack Virtual) if lists ever run to thousands.
  return (
    <Page title={category.title} back>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-7">
        {titles?.map((m) => <PosterCard key={m.id} m={m} />)}
        {loading && skeletons(titles ? 6 : 12, !error)}
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
        titles && !loading && !more && <p className="mt-10 text-center text-sm text-muted-foreground">没有更多了</p>
      )}
    </Page>
  )
}
