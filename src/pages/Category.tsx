import { Navigate, useParams, useSearchParams } from 'react-router'
import { Choices } from '@/components/Choices'
import { Page } from '@/components/Page'
import { PosterGrid } from '@/components/PosterRow'
import { useT } from '@/lib/i18n'
import { categories, sortsOf } from '@/lib/tmdb'

// The sort lives in the URL, like the pages PosterGrid has shown, so coming back from a title brings back the same list.
export default function Category() {
  const t = useT()
  const { key } = useParams()
  const [params, setParams] = useSearchParams()
  const category = categories.find((c) => c.key === key)
  if (!category) return <Navigate to="/" replace />

  const sorts = sortsOf(category, t)
  const sort = sorts.find((s) => s.key === params.get('sort')) ?? sorts[0]
  const path = sort?.path ?? category.path
  return (
    <Page title={t(...category.title)} back>
      {sort && (
        <div className="mb-10">
          {/* a new sort starts over from its first page, at the top */}
          <Choices
            legend={t('排序', 'Sort by')}
            options={sorts}
            value={sort.key}
            onChange={(s) => setParams({ sort: s }, { replace: true })}
          />
          <p className="mt-4 text-sm text-muted-foreground">{sort.hint}</p>
        </div>
      )}
      <PosterGrid path={path} />
    </Page>
  )
}
