import { Navigate, useParams } from 'react-router'
import { Page } from '@/components/Page'
import { PosterCard, PosterSkeleton } from '@/components/PosterRow'
import { type Category as CategoryType, type MediaList, categories, typeOf, useTmdb } from '@/lib/tmdb'

export default function Category() {
  const { key } = useParams()
  const category = categories.find((c) => c.key === key)
  return category ? <Grid category={category} /> : <Navigate to="/" replace />
}

function Grid({ category }: { category: CategoryType }) {
  const { data, error } = useTmdb<MediaList>(category.path)
  return (
    <Page title={category.title} back>
      {error && <p className="mb-6 text-sm text-muted-foreground">{error}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-7">
        {data
          ? data.results.map((m) => <PosterCard key={m.id} m={m} type={typeOf(category)} />)
          : Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={i} pulse={!error} />)}
      </div>
    </Page>
  )
}
