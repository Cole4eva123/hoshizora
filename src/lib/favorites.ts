import { useSyncExternalStore } from 'react'
import { type Card, hrefOf, mediaTypes } from '@/lib/tmdb'
import { storage } from '@/lib/utils'

// The 收藏夹 and which 作品 have been 看过, kept on this device as the 界面语言 is: any TMDB 作品 can be saved, on the
// web too and with no server. Emby's own favorites can't hold several 收藏夹, only one list a server, of what it has.
// ponytail: localStorage is the WebView's, per origin: `tauri dev` (localhost:1420) and the built app
// (tauri://localhost) keep 收藏夹 apart, and clearing the app's web data clears them. Keep them in a file beside
// emby.json on the Rust side if they must be shared between the two or outlive that.
export type Folder = { id: string; name: string; titles: Card[] }
export type Favorites = { folders: Folder[]; watched: string[] }

const key = 'mp2.favorites'

// Whether kept data has every part the pages read, down to each card's id and a kind of 作品 this knows: checked
// here, at the way in, as a page that met a part missing would fail to draw.
const isFavorites = (x: Favorites | undefined): x is Favorites =>
  Array.isArray(x?.watched) &&
  x.watched.every((w) => typeof w === 'string') &&
  Array.isArray(x.folders) &&
  x.folders.every(
    (f) =>
      typeof f?.id === 'string' &&
      typeof f.name === 'string' &&
      Array.isArray(f.titles) &&
      f.titles.every((m) => typeof m?.id === 'number' && Object.hasOwn(mediaTypes, m.media_type)),
  )

// What was kept, or nothing yet. Kept data this can't read (edited by hand, or by another version) is moved aside
// rather than written over; where even that can't be written (storage full), it's left to the next save.
export const parse = (raw: string | null | undefined): Favorites => {
  const none = { folders: [], watched: [] }
  if (!raw) return none
  try {
    const kept = JSON.parse(raw)
    if (isFavorites(kept)) return kept
  } catch {
    // not JSON: moved aside below
  }
  try {
    storage?.setItem(`${key}.broken`, raw)
  } catch {
    // no room for it
  }
  return none
}

// Read during render, like the 界面语言, so the 收藏 page is drawn full in its first frame.
let favorites = parse(storage?.getItem(key))
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const notify = () => listeners.forEach((l) => l())
export const getFavorites = () => favorites
export const useFavorites = () => useSyncExternalStore(subscribe, getFavorites)

// Another tab's change (the web version, in two tabs), taken in at once, so this one never writes a stale copy over it.
if (storage)
  window.addEventListener('storage', (e) => {
    if (e.key !== key && e.key !== null) return // null: storage cleared
    favorites = parse(e.newValue)
    notify()
  })

// Kept first, so a change that can't be kept doesn't show either: it throws, and what called it stops there.
// ponytail: localStorage holds about 5 MB, some 20,000 cards; past that no change goes through.
const save = (next: Favorites) => {
  storage?.setItem(key, JSON.stringify(next))
  favorites = next
  notify()
}

// A 作品 as a 收藏夹 keeps it: what its card shows, its names in the language shown when it was saved.
// ponytail: switching the 界面语言 leaves them in that language; ask TMDB for each (useDetails) if that ever matters.
const cardOf = ({ id, media_type, title, name, poster_path, release_date, first_air_date }: Card): Card => ({
  id,
  media_type,
  title,
  name,
  poster_path,
  release_date,
  first_air_date,
})

export const has = (f: Folder, m: Card) => f.titles.some((x) => hrefOf(x) === hrefOf(m))
// ponytail: a scan of every 作品 marked, per card; make `watched` a Set if thousands ever are.
export const isWatched = (fav: Favorites, m: Card) => fav.watched.includes(hrefOf(m))
const update = (id: string, change: (f: Folder) => Folder) =>
  save({ ...favorites, folders: favorites.folders.map((f) => (f.id === id ? change(f) : f)) })

// Puts the 作品 in the 收藏夹 (first, as the latest saved), or takes it out.
export const toggleIn = (id: string, m: Card) =>
  update(id, (f) => ({
    ...f,
    titles: has(f, m) ? f.titles.filter((x) => hrefOf(x) !== hrefOf(m)) : [cardOf(m), ...f.titles],
  }))

// A new 收藏夹 at the end, with `m` in it if given; its id.
export const addFolder = (name: string, m?: Card) => {
  // eleven random letters and digits; crypto.randomUUID is missing on plain http, as a dev server on the LAN is
  const id = Math.random().toString(36).slice(2)
  save({ ...favorites, folders: [...favorites.folders, { id, name, titles: m ? [cardOf(m)] : [] }] })
  return id
}

export const renameFolder = (id: string, name: string) => update(id, (f) => ({ ...f, name }))
export const removeFolder = (id: string) => save({ ...favorites, folders: favorites.folders.filter((f) => f.id !== id) })

// 看过 goes with the 作品, whichever 收藏夹 it's in.
export const toggleWatched = (m: Card) =>
  save({
    ...favorites,
    watched: isWatched(favorites, m)
      ? favorites.watched.filter((x) => x !== hrefOf(m))
      : [...favorites.watched, hrefOf(m)],
  })
