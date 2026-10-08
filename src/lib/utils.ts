import { cn } from "cn"
import { useSearchParams } from "react-router"
import type { Star } from "@/components/Constellation"

export { cn }

// One option of a Choices row, picked or not: a quiet word, and under the picked one a star in --tone, the way the
// corner menu's current page shines. Also dresses a control that sits in the row, like the menu of older seasons.
export const choice = (picked: boolean) =>
  cn(
    'relative cursor-pointer rounded-sm py-1 text-[15px] text-muted-foreground transition-colors hover:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-tone',
    'after:absolute after:-bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-tone after:opacity-0 after:shadow-[0_0_6px_1px_var(--tone)] after:transition-opacity',
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

// One server, its light on: the 指定服务器 search scope, and each 服务器 on the 媒体库 page, where the light (7, 12) shows
// whether it's connected. Kept here as a component file can't share it (fast refresh).
export const server: Star[][] = [[[3, 7], [21, 7], [21, 17], [3, 17], [3, 7]], [[7, 12]]]

// The pages of a list a PagedGrid shows, from the URL (?pages=N), so coming back from a title brings back as many as
// there were, and the scroll position with them.
export const usePages = () => Math.max(1, Math.floor(Number(useSearchParams()[0].get('pages'))) || 1)
