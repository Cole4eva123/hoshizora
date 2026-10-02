import { NavLink, Outlet, ScrollRestoration, useMatch } from 'react-router'
import { Heart, House, LibraryBig, Search, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/', label: '首页', icon: House },
  { to: '/favorites', label: '收藏', icon: Heart },
  { to: '/library', label: '媒体库', icon: LibraryBig },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/settings', label: '设置', icon: Settings }, // last item, pinned to the bottom
]

export default function App() {
  const inCategory = useMatch('/category/:key') !== null

  return (
    <>
      <nav
        aria-label="主导航"
        className="fixed inset-y-0 left-0 z-30 flex w-(--rail) flex-col gap-1 border-r border-white/6 bg-background/55 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] backdrop-blur-2xl backdrop-saturate-150"
      >
        <div className="mb-6 flex items-center justify-center gap-2.5 md:justify-start md:px-5">
          <span className="grid size-9 place-items-center rounded-lg bg-primary font-heading text-xl font-black text-primary-foreground">
            映
          </span>
          <span className="hidden font-heading text-xl font-black md:inline">放映室</span>
        </div>
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'mx-2 flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] text-muted-foreground transition-colors last:mt-auto hover:bg-white/4 hover:text-foreground md:mx-3 md:flex-row md:gap-3 md:px-3 md:text-[15px]',
                (isActive || (to === '/' && inCategory)) && 'bg-white/7 text-foreground [&>svg]:text-primary',
              )
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="pl-(--rail)">
        <Outlet />
      </main>
      <ScrollRestoration />
    </>
  )
}
