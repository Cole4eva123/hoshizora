import { useEffect, useRef } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { Page } from '@/components/Page'
import { Pills } from '@/components/Pills'
import { PosterCard, PosterSkeletons } from '@/components/PosterRow'
import { Button } from '@/components/ui/button'
import { categories, sortsOf, useTitles } from '@/lib/tmdb'

// The sort and the pages shown live in the URL, so coming back from a title brings back the same list, as long as
// it was, and the scroll position with it.
export default function Category() {
  const { key } = useParams()
  const [params, setParams] = useSearchParams()
  const category = categories.find((c) => c.key === key)
  if (!category) return <Navigate to="/" replace />

  const sorts = sortsOf(category)
  const sort = sorts.find((s) => s.key === params.get('sort')) ?? sorts[0]
  const path = sort?.path ?? category.path
  return (
    <Page title={category.title} back>
      {sort && (
        <div className="mb-8">
          {/* a new sort starts over from its first page, at the top */}
          <Pills legend="排序" options={sorts} value={sort.key} onChange={(s) => setParams({ sort: s }, { replace: true })} />
          <p className="mt-3 text-sm text-muted-foreground">{sort.hint}</p>
        </div>
      )}
      <Titles path={path} />
    </Page>
  )
}

function Titles({ path }: { path: string }) {
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-7">
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
        titles && !loading && !more && <p className="mt-10 text-center text-sm text-muted-foreground">没有更多了</p>
      )}
    </>
  )
}
