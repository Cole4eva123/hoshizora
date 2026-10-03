import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, type LucideIcon } from 'lucide-react'

export function Page({ title, back, children }: { title: string; back?: boolean; children: ReactNode }) {
  return (
    // the top padding clears the corner menu
    <div className="px-(--gutter) pt-[calc(max(var(--gutter),env(safe-area-inset-top))+4.5rem)] pb-[max(4rem,env(safe-area-inset-bottom))]">
      {back && (
        <Link to="/" className="-ml-1 mb-3 flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />
          首页
        </Link>
      )}
      <h1 className="font-heading text-3xl font-black md:text-4xl">{title}</h1>
      <div className="mt-8">{children}</div>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="max-w-md">
      <Icon className="size-7 text-muted-foreground" strokeWidth={1.5} />
      <h2 className="mt-4 text-lg font-medium">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  )
}
