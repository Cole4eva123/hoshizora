import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

// The session-wide cache behind TMDB's hooks and the 服务器's, keyed by what was asked for (a TMDB path, an Emby URL),
// so identical requests share one.
// ponytail: cached for the whole session, add a TTL if long sessions show stale rows; answers would then change,
// which useAnswers' memo assumes they don't
const cache = new Map<string, Promise<void>>()
// What the settled requests answered; an answer never changes once in. Hooks read it during render, so a page that
// mounts again (back from a title) is drawn full height in its first frame, when the router restores its scroll.
const answers = new Map<string, unknown>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Asks `get` for `key` unless it has been asked already. A request forgotten while on its way is no longer the key's:
// its answer goes nowhere, and its failure leaves the one asked since in place.
export function ask(key: string, get: (key: string) => Promise<unknown>) {
  const asked = cache.get(key)
  if (asked) return asked
  const p: Promise<void> = get(key).then((data) => {
    if (cache.get(key) !== p) return
    answers.set(key, data)
    listeners.forEach((l) => l())
  })
  p.catch(() => cache.get(key) === p && cache.delete(key)) // failed requests are asked again on retry or the next mount
  cache.set(key, p)
  return p
}

// Forgets the answers to the keys that start with `prefix`, so the next hook to mount asks for them again. Only for
// keys no mounted hook reads: one would lose its answer on its next render, and not ask again.
export function forget(prefix: string) {
  for (const key of cache.keys())
    if (key.startsWith(prefix)) {
      cache.delete(key)
      answers.delete(key)
    }
}

// The keys a joined key stands for; none for the empty key of a hook asked for nothing.
const keysOf = (joined: string) => (joined ? joined.split('\n') : [])

// The answers to several requests, in order, each undefined until it arrives, and never another request's answer.
// The missing ones are asked of `get`, which is asked again for those still missing when it changes (keep it the same
// between renders); `retry` asks again for the ones that failed. `failed` holds the error one of them failed with, as
// `get` threw it.
export function useAnswers<T>(keys: string[], get: (key: string) => Promise<T>) {
  const joined = keys.join('\n')
  // which of these answers are in, like '1101'; it changes, and so re-renders, when one comes in
  const settled = useSyncExternalStore(subscribe, () => keys.map((k) => (answers.has(k) ? 1 : 0)).join(''))
  const data = useMemo(
    () => keysOf(joined).map((k, i) => (settled[i] === '1' ? (answers.get(k) as T) : undefined)),
    [joined, settled],
  )
  const [failed, setFailed] = useState<{ joined: string; error: unknown }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    for (const k of keysOf(joined)) ask(k, get).catch((error) => live && setFailed({ joined, error }))
    return () => {
      live = false
      setFailed(undefined) // an error goes with its request: other requests, and a retry, start clean
    }
  }, [joined, attempt, get])
  const retry = () => setAttempt((n) => n + 1)
  return { data, failed: failed?.joined === joined ? failed : undefined, retry }
}

// The answers in so far, from the first: a list's pages stay on screen while the next one loads.
export const arrivedOf = <T>(data: (T | undefined)[]) => {
  const gap = data.indexOf(undefined)
  return (gap < 0 ? data : data.slice(0, gap)) as T[]
}
