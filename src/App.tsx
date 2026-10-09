import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { Constellation, type Star } from '@/components/Constellation'
import { type Copy, type Translate, en, setLang, useT, zh } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Each page's icon is a small constellation, drawn like the logo beside them: a house, a star, two frames stacked, a
// lens and its handle, two sliders.
const nav: { to: string; label: Copy; icon: Star[][] }[] = [
  { to: '/', label: ['首页', 'Home'], icon: [[[12, 3], [20, 10], [20, 20], [4, 20], [4, 10], [12, 3]]] },
  {
    to: '/favorites',
    label: ['收藏', 'Favorites'],
    icon: [[[12, 3.3], [17.6, 20.5], [3, 9.9], [21, 9.9], [6.4, 20.5], [12, 3.3]]],
  },
  {
    to: '/library',
    label: ['媒体库', 'Library'],
    icon: [
      [[3, 9], [16, 9], [16, 21], [3, 21], [3, 9]],
      [[7, 4], [21, 4], [21, 17]],
    ],
  },
  {
    to: '/search',
    label: ['搜索', 'Search'],
    icon: [[[15.5, 15.5], [8.7, 17.3], [3.7, 12.3], [5.5, 5.5], [12.3, 3.7], [17.3, 8.7], [15.5, 15.5], [21, 21]]],
  },
  {
    to: '/settings',
    label: ['设置', 'Settings'],
    icon: [
      [[3, 8], [15, 8, 2.6], [21, 8]],
      [[3, 16], [9, 16, 2.6], [21, 16]],
    ],
  },
]

// The Mac app draws the page under a see-through title bar (tauri.conf.json), its window buttons over the top-left
// corner. A strip across the top moves the window, as the title bar did.
const inApp = '__TAURI_INTERNALS__' in window
document.documentElement.toggleAttribute('data-app', inApp) // index.css moves the corner menu below the buttons

export default function App() {
  const t = useT()
  const { pathname } = useLocation()
  // categories, titles and their actors are opened from Home, so Home stays highlighted there
  const underHome = /^\/(category|movie|tv|person)\//.test(pathname)
  // Hover and keyboard focus unroll the menu in CSS; `open` is for taps, which have no hover.
  const [open, setOpen] = useState(false)

  return (
    <>
      {inApp && <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-40 h-7" />}
      {/* The logo floats in the top-left corner with nothing around it, see-through until used. The pages unroll
          to its right on a bar of the logo's night sky. */}
      <nav
        aria-label={t('主导航', 'Main')}
        data-open={open || undefined}
        onMouseLeave={() => setOpen(false)}
        //离屏幕顶部的距离，取 CSS 变量 --menu-top
        //离屏幕左边的距离，取 CSS 变量 --gutter
        className="group peer fixed top-(--menu-top) left-(--gutter) z-30 flex items-center gap-1.5"
      >
        <button
          // 按钮里只有图片（alt 为空），读屏软件靠这个名字念出"菜单"
          aria-label={t('菜单', 'Menu')}
          // 告诉读屏软件菜单现在是展开还是收起
          aria-expanded={open}
          // 点一下切换展开/收起：手机没有悬停，只能靠点
          onClick={() => setOpen(!open)}
          // size-10：40×40；shrink-0：菜单栏展开时不被挤小；rounded-xl：圆角，键盘聚焦的描边也跟着圆
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
            link row: mid-way the row's track is narrower than the grid, which would leave the text ahead of the glass.
            It stops at the right gutter: on a phone the links don't all fit, so it scrolls sideways, its end
            fading while there's more. The grid is the scroller itself, as a mask on a wrapper would stop the glass
            from blurring what's behind it. */}
        <div
          // 展开动画：grid 只有一列，平时 0fr（宽 0，overflow-x-auto 把文字裁掉）；
          //   nav 被悬停（group-hover）、键盘聚焦（group-has-focus-visible）或点开（group-data-open）时变 1fr，
          //   正好装下所有链接。width 没法从 0 过渡到 auto，0fr→1fr 可以，所以用 grid。
          // transition-[grid-template-columns] duration-300 ease-out：列宽变化用 0.3 秒、先快后慢；
          //   motion-reduce:transition-none：系统开了"减少动态效果"就不做动画
          // rounded-xl：圆角，和 logo 按钮一致
          // 毛玻璃：bg-night/80 夜空蓝 80% 不透明，backdrop-blur-xl 模糊背后画面，backdrop-saturate-150 让模糊后不发灰
          // inset-ring inset-ring-star/15：内侧一圈 15% 不透明的星光色细边
          className="no-scrollbar scroll-hint grid max-w-[calc(100vw-2*var(--gutter)-2.875rem)] grid-cols-[0fr] overflow-x-auto overscroll-x-contain rounded-xl bg-night/80 inset-ring inset-ring-star/15 backdrop-blur-xl backdrop-saturate-150 transition-[grid-template-columns] duration-300 ease-out group-hover:grid-cols-[1fr] group-has-focus-visible:grid-cols-[1fr] group-data-open:grid-cols-[1fr] motion-reduce:transition-none">
          <div className="flex min-w-0">
            {nav.map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                viewTransition
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-lg px-3 text-[15px] leading-10 whitespace-nowrap text-star/70 -outline-offset-2 transition-colors hover:text-star',
                    // the current page shines like the logo's bright star, its constellation too
                    (isActive || (to === '/' && underHome)) &&
                      'font-medium text-white [text-shadow:0_0_12px_var(--glow)] hover:text-white *:drop-shadow-[0_0_6px_var(--glow)]',
                  )
                }
              >
                <Constellation lines={icon} />
                {t(...label)}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
      <LangSwitch />
      <main>
        <Outlet />
      </main>
      <ScrollRestoration />
    </>
  )
}

// The logo's counterpart in the top-right corner, and as quiet: starlight that brightens when pointed at, the language
// shown lit like the menu's current page, a constellation's line between the two. Picking the other one cross-fades
// the page into it. On a phone the open menu bar runs across this corner, so the switch steps aside meanwhile, and sits
// under the bar. Not while the menu has keyboard focus, though: Tab from the last link has to land on the switch.
function LangSwitch() {
  const t = useT()
  useEffect(() => {
    document.documentElement.lang = t('zh-CN', 'en') // for screen readers, and the fonts' choice of glyphs
  }, [t])
  const pick = (lang: Translate) => {
    if (lang === t) return
    const change = () => flushSync(() => setLang(lang))
    if (document.startViewTransition) document.startViewTransition(change)
    else change()
  }
  const option =
    'h-10 rounded-sm px-1.5 text-star/85 transition-colors hover:text-star aria-pressed:font-medium aria-pressed:text-white aria-pressed:[text-shadow:0_0_12px_var(--glow)]'
  // -mr-1.5: the last word's padding hangs into the gutter, so its letters end where the page does
  return (
    <div
      role="group"
      aria-label={t('界面语言', 'Language')}
      className="fixed top-(--menu-top) right-(--gutter) z-20 -mr-1.5 flex items-center text-[13px] opacity-75 transition-opacity hover:opacity-100 has-focus-visible:opacity-100 max-sm:peer-hover:invisible max-sm:peer-data-open:invisible"
    >
      <button lang="zh-CN" aria-pressed={t === zh} onClick={() => pick(zh)} className={option}>
        中文
      </button>
      <span aria-hidden="true" className="h-3.5 w-px rotate-20 bg-star/50" />
      <button
        lang="en"
        aria-label="English"
        aria-pressed={t === en}
        onClick={() => pick(en)}
        className={cn(option, 'tracking-wider')}
      >
        ENG
      </button>
    </div>
  )
}
