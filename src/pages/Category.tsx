import { Navigate, useParams } from 'react-router'
import { Page } from '@/components/Page'
import { PosterCard, PosterSkeleton } from '@/components/PosterRow'
import { type Category as CategoryType, categories, useTitles } from '@/lib/tmdb'

export default function Category() {
  const { key } = useParams()
  const category = categories.find((c) => c.key === key)
  return category ? <Grid category={category} /> : <Navigate to="/" replace />
}

function Grid({ category }: { category: CategoryType }) {
  const { titles, error } = useTitles(category.path)
  return (
    <Page title={category.title} back>
      {error && <p className="mb-6 text-sm text-muted-foreground">{error}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-7">
        {titles
          ? titles.map((m) => <PosterCard key={m.id} m={m} />)
          : Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={i} pulse={!error} />)}
      </div>
    </Page>
  )
}
