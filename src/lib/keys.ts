import axios from 'axios'
import { useSyncExternalStore } from 'react'
import { storage, storageKey } from '@/lib/utils'

// The keys the pages ask other services with, each as the app was built with it (.env.local, or the Pages build's
// Actions secrets: readable by anyone who has the app, as with any key a page sends itself), which the user may put
// their own in place of in Settings, kept on this device only. The TMDB one built in serves everyone, as Nuvio and
// Jellyfin ship theirs; MDBList's free keys allow 1000 requests a day each, so a build for others leaves its out.
const built = {
  tmdb: import.meta.env.VITE_TMDB_TOKEN as string | undefined,
  mdblist: import.meta.env.VITE_MDBLIST_KEY as string | undefined,
}
export type Key = keyof typeof built
type Own = Partial<Record<Key, string>>

const key = storageKey('keys')
// What's kept, as far as it's keys of the known services: anything else (no JSON, another shape) is none.
export function ownOf(kept: string | null | undefined): Own {
  try {
    const value: unknown = JSON.parse(kept ?? '{}')
    if (!value || typeof value !== 'object') return {}
    const keys = Object.entries(value).filter(([k, v]) => Object.hasOwn(built, k) && typeof v === 'string' && v)
    return Object.fromEntries(keys)
  } catch {
    return {}
  }
}

let own = ownOf(storage?.getItem(key))
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The key a request goes with now: the user's own, else the one built in.
export const apiKeyOf = (k: Key) => own[k] ?? built[k]
export const hasBuiltIn = (k: Key) => Boolean(built[k])
// Whether the user put their own in, and the key requests go with now, read during render.
export const useOwnKey = (k: Key) => useSyncExternalStore(subscribe, () => k in own)
export const useKey = (k: Key) => useSyncExternalStore(subscribe, () => apiKeyOf(k))

// Puts the user's own key in place of the one built in, or takes it out (none): written before it shows, so one
// storage refuses (full) throws and changes nothing; with no storage at all (blocked), kept till the page closes, as
// the 界面语言 is.
export function setOwnKey(k: Key, value?: string) {
  const next: Own = { ...own, [k]: value }
  if (!value) delete next[k]
  storage?.setItem(key, JSON.stringify(next))
  own = next
  listeners.forEach((l) => l())
}

// another tab's change taken in (or its storage cleared, no key named), as a request here would otherwise go on with
// the old key
globalThis.window?.addEventListener('storage', (e) => {
  if (e.key !== key && e.key !== null) return
  own = ownOf(e.newValue)
  listeners.forEach((l) => l())
})

// Why a service didn't take a key it was asked with: turned down (401, 403), another error (its status: the day's
// requests used up, the service down), or not reached; and the storage refusing it, once taken.
export type Why = 'rejected' | number | 'unreachable' | 'unkept'
// What a service said of a key it was asked with (`asked`): none when it took it, else why not.
export const checked = (asked: Promise<unknown>): Promise<Why | undefined> =>
  asked.then(
    () => undefined,
    (e: unknown) => {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined
      return status === 401 || status === 403 ? 'rejected' : (status ?? 'unreachable')
    },
  )
