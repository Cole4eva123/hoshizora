import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { isTauri } from '@tauri-apps/api/core'
import { Constellation, type Star } from '@/components/Constellation'
import { type Copy, type Translate, en, setLang, useT, zh } from '@/lib/i18n'
import { mediaTypes } from '@/lib/tmdb'
import { cn, lens, pentagram, sliders, star } from '@/lib/utils'

// Each page's icon is a small constellation, drawn like the logo beside them: a house, a star, two frames stacked, a
// lens and its handle, two sliders.
const nav: { to: string; label: Copy; icon: Star[][] }[] = [
  { to: '/', label: ['首页', 'Home'], icon: [[[12, 3], [20, 10], [20, 20], [4, 20], [4, 10], [12, 3]]] },
  { to: '/favorites', label: ['收藏', 'Favorites'], icon: pentagram },
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
    icon: lens,
  },
  { to: '/settings', label: ['设置', 'Settings'], icon: sliders },
]

// The pages come out of the logo one after another, 70 ms apart: each link's --stagger.
// ponytail: one per page, written out as Tailwind only sees whole class names; a sixth page needs a sixth here, or it
// comes out first.
const stagger = ['[--stagger:0ms]', '[--stagger:70ms]', '[--stagger:140ms]', '[--stagger:210ms]', '[--stagger:280ms]']
// Each constellation draws itself as it comes out: its lines run out from their first star as its stars come up.
const draw =
  '[&_polyline]:[stroke-dasharray:1] [&_polyline]:[stroke-dashoffset:1] menu-open:[&_polyline]:[stroke-dashoffset:0] [&_circle]:origin-center [&_circle]:scale-0 [&_circle]:transform-fill menu-open:[&_circle]:scale-100 [&_*]:transition-[stroke-dashoffset,scale] menu-open:[&_*]:delay-(--stagger) menu-open:[&_*]:duration-600 motion-reduce:[&_*]:transition-none'
// Its word fades in beside it. They all go back at once, quickly.
const appear =
  '-translate-x-1 opacity-0 transition-[opacity,translate] menu-open:translate-x-0 menu-open:opacity-100 menu-open:delay-(--stagger) menu-open:duration-500 motion-reduce:transition-none'

// The pages opened from Home (its 分类, their 作品, and their actors), which keep it highlighted
const fromHome = ['category', 'person', ...Object.keys(mediaTypes)]

// The Mac app draws the page under a see-through title bar (tauri.conf.json), its window buttons over the top-left
// corner. A strip across the top moves the window, as the title bar did.
const inApp = isTauri()
document.documentElement.toggleAttribute('data-app', inApp) // index.css moves the corner menu below the buttons

export default function App() {
  const t = useT()
  const { pathname } = useLocation()
  const underHome = fromHome.includes(pathname.split('/')[1])
  // Hover and keyboard focus open the menu in CSS (menu-open:, index.css); `open` is for taps, which have no hover.
  const [open, setOpen] = useState(false)

  return (
    <>
      {inApp && <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-40 h-7" />}
      {/* The logo floats in the top-left corner with nothing around it, see-through until used. Its pages come out to
          its right, over a corner of the sky that darkens behind them so they read over a bright still. Until then
          only the logo takes the pointer: the links wait unseen in their places, and pointing there opens nothing. */}
      <nav
        id="menu"
        aria-label={t('主导航', 'Main')}
        data-open={open || undefined}
        onMouseLeave={() => setOpen(false)}
        // Tabbing out puts it away, as a tap may have left it open.
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
        //离屏幕顶部的距离，取 CSS 变量 --menu-top
        //离屏幕左边的距离，取 CSS 变量 --gutter
        className={cn(
          'pointer-events-none fixed top-(--menu-top) left-(--gutter) z-30 flex items-center',
          'before:fixed before:inset-x-0 before:top-0 before:-z-10 before:h-64 before:bg-radial-[80rem_22rem_at_top_left] before:from-night/85 before:from-10% before:to-transparent before:to-70% before:opacity-0 before:transition-opacity before:duration-300 menu-open:before:opacity-100 motion-reduce:before:transition-none',
        )}
      >
        <button
          // 按钮里只有图片（alt 为空），读屏软件靠这个名字念出"菜单"
          aria-label={t('菜单', 'Menu')}
          // 告诉读屏软件菜单现在是展开还是收起
          aria-expanded={open}
          // 点一下切换展开/收起：手机没有悬停，只能靠点
          onClick={() => setOpen(!open)}
          // size-(--logo)：logo 的大小，菜单行和返回按钮都按它留位置；shrink-0：菜单栏展开时不被挤小
          // rounded-xl：圆角，键盘聚焦的描边也跟着圆
          // pointer-events-auto：nav 本身不接鼠标，只有 logo 接，指到它才打开菜单
          className="pointer-events-auto size-(--logo) shrink-0 rounded-xl"
        >
          {/* 午夜星辰播放三角.png cropped to the constellation, with its navy background made transparent */}
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="" 
            className="size-full opacity-75 transition-opacity menu-open:opacity-100"
          />
        </button>
        {/* The row stops at the right gutter: on a phone the links don't all fit, so it scrolls sideways, its end
            fading while there's more. Scrolling sideways clips it top and bottom too, so it has room for the glow of
            the star under the current page's word. */}
        <div className="no-scrollbar scroll-hint -my-1 flex max-w-[calc(var(--content)-var(--logo))] overflow-x-auto overscroll-x-contain py-1 menu-open:pointer-events-auto">
          {nav.map(({ to, label, icon }, i) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              viewTransition
              onClick={() => setOpen(false)}
              className={cn(
                'flex h-10 items-center gap-2 rounded-lg px-3 text-[15px] whitespace-nowrap text-star/70 -outline-offset-2 transition-colors hover:text-star',
                stagger[i],
              )}
            >
              {({ isActive }) => {
                // the current page is lit, its constellation glowing like the logo's bright star, with the star under
                // its word as Choices marks the picked one
                const lit = isActive || (to === '/' && underHome)
                return (
                  <>
                    <Constellation
                      lines={icon}
                      className={cn(draw, lit && 'text-white drop-shadow-[0_0_6px_var(--glow)]')}
                    />
                    <span className={cn(appear, lit && ['text-white', star])}>{t(...label)}</span>
                  </>
                )
              }}
            </NavLink>
          ))}
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
// shown lit white in a glow, a constellation's line between the two. Picking the other one cross-fades the page into
// it. Below md the open menu's row can reach this corner, so the switch fades out meanwhile; it only fades, so Tab from
// the last link still lands on it, which puts the menu away.
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
      className="fixed top-(--menu-top) right-(--gutter) z-20 -mr-1.5 flex items-center text-[13px] opacity-75 transition-opacity hover:opacity-100 has-focus-visible:opacity-100 max-md:menu-open:pointer-events-none max-md:menu-open:opacity-0"
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
