import { useState } from 'react'
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/', label: '首页' },
  { to: '/favorites', label: '收藏' },
  { to: '/library', label: '媒体库' },
  { to: '/search', label: '搜索' },
  { to: '/settings', label: '设置' },
]

export default function App() {
  const { pathname } = useLocation()
  // categories and titles are opened from Home, so Home stays highlighted there
  const underHome = /^\/(category|movie|tv)\//.test(pathname)
  // Hover and keyboard focus unroll the menu in CSS; `open` is for taps, which have no hover.
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* The logo floats in the top-left corner with nothing around it, see-through until used. The pages unroll
          to its right on a bar of the logo's night sky. */}
      <nav
        aria-label="主导航"
        data-open={open || undefined}
        onMouseLeave={() => setOpen(false)}
        className="group fixed top-[max(var(--gutter),env(safe-area-inset-top))] left-(--gutter) z-30 flex items-center gap-1.5"
      >
        <button
          aria-label="菜单"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="size-10 shrink-0 rounded-xl"
        >
          {/* 午夜星辰播放三角.png cropped to the constellation, with its navy background made transparent */}
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt=""
            className="size-full opacity-75 transition-opacity group-hover:opacity-100 group-has-focus-visible:opacity-100 group-data-open:opacity-100"
          />
        </button>
        {/* The bar. 0fr→1fr animates its width to fit the links. The glass and the clip sit on the grid, not the
            link row: mid-way the row's track is narrower than the grid, which would leave the text ahead of the glass. */}
        <div className="grid grid-cols-[0fr] overflow-hidden rounded-xl bg-night/80 inset-ring inset-ring-star/15 backdrop-blur-xl backdrop-saturate-150 transition-[grid-template-columns] duration-300 ease-out group-hover:grid-cols-[1fr] group-has-focus-visible:grid-cols-[1fr] group-data-open:grid-cols-[1fr] motion-reduce:transition-none">
          <div className="flex min-w-0">
            {nav.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 text-[15px] leading-10 whitespace-nowrap text-star/70 -outline-offset-2 transition-colors hover:text-star',
                    // the current page shines like the logo's bright star
                    (isActive || (to === '/' && underHome)) &&
                      'font-medium text-white [text-shadow:0_0_12px_var(--glow)] hover:text-white',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
      <main>
        <Outlet />
      </main>
      <ScrollRestoration />
    </>
  )
}
