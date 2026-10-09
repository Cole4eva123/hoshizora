import { cn } from "cn"
import { useSearchParams } from "react-router"
import type { Star } from "@/components/Constellation"
import type { Status } from "@/lib/emby"

export { cn }

// The star under a word, in --tone: the picked option's in a Choices row, the current page's in the corner menu.
export const star =
  'relative after:absolute after:-bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-tone after:shadow-[0_0_6px_1px_var(--tone)]'

// One option of a Choices row, picked or not: a quiet word, and under the picked one the star. Also dresses a control
// that sits in the row, like the menu of older seasons.
export const choice = (picked: boolean) =>
  cn(
    'cursor-pointer rounded-sm py-1 text-[15px] text-muted-foreground transition-colors hover:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-tone',
    star,
    'after:opacity-0 after:transition-opacity',
    picked && 'text-foreground after:opacity-100',
  )

// A picture fades in once it has loaded instead of painting in strips (with `opacity-0 data-loaded:opacity-100`). Use
// it as the img's ref and onLoad: the ref catches one that is already in, as when a page is drawn again from cache.
export const reveal = (img: HTMLImageElement | null) => {
  if (img?.complete && img.naturalWidth) img.dataset.loaded = ''
}

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

// The pages of a list a PagedGrid shows, from the URL (?pages=N), so coming back from a title brings back as many as
// there were, and the scroll position with them.
export const usePages = () => Math.max(1, Math.floor(Number(useSearchParams()[0].get('pages'))) || 1)
