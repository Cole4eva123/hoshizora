import { createCn } from "cn/config"
import { useSearchParams } from "react-router"
import type { Star } from "@/components/Constellation"
import type { Server, Status } from "@/lib/emby"

// Tailwind's class merging, told the theme's own sizes and glows (index.css @theme): unknown, it takes `text-body` for a
// colour, which a later colour drops, and `shadow-dot` for a shadow's colour, which `shadow-(color:--glow)` drops.
// ponytail: compiled when the page loads (cn/config, about 75 KB more script than "cn"'s prebuilt tables); have the
// cn/vite plugin build them from index.css at build time if the first load ever drags.
export const cn = createCn({
  extend: {
    theme: {
      text: ["body", "name", "detail"],
      shadow: ["dot", "dot-lg", "lit"],
      "drop-shadow": ["glow", "glow-lg"],
      "text-shadow": ["glow", "night"],
    },
  },
})

// The star under a word, in --tone: the picked option's in a Choices row, the current page's in the corner menu.
export const star =
  'relative after:absolute after:-bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-tone after:shadow-dot'

// A constellation's line between two words: the two languages, the sorts and the 类型.
export const divider = 'h-3.5 w-px rotate-20 bg-star/50'

// One option of a Choices row, picked or not: a quiet word, and under the picked one the star. Also dresses a control
// that sits in the row, like the menu of older seasons.
export const choice = (picked: boolean) =>
  cn(
    'cursor-pointer rounded-sm py-1 text-body text-muted-foreground transition-colors hover:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-tone',
    star,
    'after:opacity-0 after:transition-opacity',
    picked && 'text-foreground after:opacity-100',
  )

// A picture fades in once it has loaded instead of painting in strips (with `opacity-0 data-loaded:opacity-100`). Use
// it as the img's ref and onLoad: the ref catches one that is already in, as when a page is drawn again from cache.
export const reveal = (img: HTMLImageElement | null) => {
  if (img?.complete && img.naturalWidth) img.dataset.loaded = ''
}

// What this app keeps in storage goes under its own prefix, as every app on github.io shares one origin's storage: mp2,
// the course repo's name, kept so what's saved stays found.
export const storageKey = (name: string) => `mp2.${name}`

// The 媒体库 page, and a 服务器's there, by its id and its user's, as one server can be signed in as two users.
export const libraryHref = '/library'
export const serverHref = (s: Pick<Server, 'id' | 'userId'>) => `${libraryHref}/${s.id}/${s.userId}`

// How long the second press that 移除 and 删除 ask for is waited for, after the first.
export const confirmFor = 3000

// What a cast card's headshot and an actor's portrait are named for the view transition, so the one grows into the other.
export const portrait = '[view-transition-name:portrait]'

// This device's localStorage, or none where it's blocked or missing (under bun test): then what's kept lasts until the
// page closes.
export const storage = (() => {
  try {
    return localStorage
  } catch {
    return undefined
  }
})()

// One server, its light on: the 指定服务器 search scope, and each 服务器's ServerMark, where the light (7, 12) shows
// whether it's connected. Kept here as a component file can't share it (fast refresh).
export const server: Star[][] = [[[3, 7], [21, 7], [21, 17], [3, 17], [3, 7]], [[7, 12]]]

// A lens and its handle: the corner menu's 搜索, and the mark at the start of the search line.
export const lens: Star[][] = [
  [[15.5, 15.5], [8.7, 17.3], [3.7, 12.3], [5.5, 5.5], [12.3, 3.7], [17.3, 8.7], [15.5, 15.5], [21, 21]],
]

// A pentagram: the corner menu's 收藏, and a 作品's 收藏 button.
export const pentagram: Star[][] = [[[12, 3.3], [17.6, 20.5], [3, 9.9], [21, 9.9], [6.4, 20.5], [12, 3.3]]]

// A dialog's box, a patch of the card colour over the page dimmed and blurred: a 服务器's settings, a 收藏夹's. Tailwind
// zeroes every margin, the dialog's centring included, so m-auto puts it back.
export const dialogBox =
  'm-auto w-[min(26rem,var(--content))] rounded-2xl bg-card p-6 text-foreground inset-ring inset-ring-star/15 backdrop:bg-night/70 backdrop:backdrop-blur-sm'

// The logo's play triangle, three stars: the 播放 button on a 作品's 画报墙.
export const play: Star[][] = [[[7, 4], [20, 12], [7, 20], [7, 4]]]

// Two sliders, bigger stars for their knobs: the corner menu's 设置, and a 服务器's settings on its tile.
export const sliders: Star[][] = [
  [[3, 8], [15, 8, 2.6], [21, 8]],
  [[3, 16], [9, 16, 2.6], [21, 16]],
]

// A 服务器's colour (--tone) for how it answers: green when connected, grey while it's being asked, red otherwise.
export const toneOf = (status: Status) =>
  status === 'online'
    ? '[--tone:var(--online)]'
    : status === 'checking'
      ? '[--tone:var(--muted-foreground)]'
      : '[--tone:var(--destructive)]'

// The most items a row or grid's line shows: the largest `--cols` its classes set (PosterRow's), for as many
// placeholders as fill it.
export const mostCols = (classes: string) => Math.max(...[...classes.matchAll(/--cols:(\d+)/g)].map((c) => Number(c[1])))

// The pages of a list a PagedGrid shows, from the URL (?pages=N), so coming back from a title brings back as many as
// there were, and the scroll position with them.
export const usePages = () => Math.max(1, Math.floor(Number(useSearchParams()[0].get('pages'))) || 1)
