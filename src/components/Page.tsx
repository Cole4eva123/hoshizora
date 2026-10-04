import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

// The title is set large, like a title card.
export function Page({ title, back, children }: { title: string; back?: boolean; children: ReactNode }) {
  return (
    <div className="px-(--gutter) pt-(--page-top) pb-(--page-bottom)">
      {back && <BackButton />}
      <h1 className="font-heading text-5xl font-black md:text-7xl">{title}</h1>
      <div className="mt-8 md:mt-10">{children}</div>
    </div>
  )
}

// Back to wherever the page was opened from. A page opened directly has nothing in the app to go back to, so that
// goes home. React Router numbers its history entries from 0 in history.state.idx, and replacing the URL (a category
// paging on) keeps the number. Sits beside the corner menu's logo, at its height.
// ponytail: idx is React Router's bookkeeping, not its API; if an upgrade drops it, 返回 always goes home. Switch to
// the Navigation API's navigation.canGoBack then.
export function BackButton() {
  const navigate = useNavigate()
  return (
    <Button
      variant="ghost"
      onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/'))}
      className="absolute top-(--menu-top) left-[calc(var(--gutter)+3rem)] h-10"
    >
      <ChevronLeft />
      返回
    </Button>
  )
}

// Where the empty states send people: servers are connected in the 媒体库.
export function ToLibrary() {
  return (
    <Link to="/library" viewTransition className="text-primary hover:underline">
      媒体库
    </Link>
  )
}

// A section's serif heading: a row's, an empty state's, an actor's 作品.
export const sectionTitle = 'font-heading text-xl font-black md:text-2xl'

// What an empty page or section says, and where to go to fill it.
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-md">
      <h2 className={sectionTitle}>{title}</h2>
      <p className="mt-3 text-[15px] leading-7 text-muted-foreground">{children}</p>
    </div>
  )
}
