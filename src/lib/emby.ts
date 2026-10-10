import { invoke, isTauri } from '@tauri-apps/api/core'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { arrivedOf, forget, useAnswers } from '@/lib/cache'
import { type Translate, useT } from '@/lib/i18n'
import type { Lineup, MediaType } from '@/lib/tmdb'

// Emby lives on the app's Rust side (src-tauri/emby-core): it finds where a 服务器 answers, signs in, keeps the token
// where no page script can read it, and asks the server. This module hands its answers to the pages through cache.ts.
// The web version has no Rust side, and so no Emby.
export const canConnect = isTauri()

// A 服务器 kept on this device, as the Rust side shows it: where it is, who signed in and when, and its 备注 if the user
// gave one; never its token. One server signed in as two users is two entries.
export type Server = {
  id: string
  name: string
  nickname?: string
  address: string
  userId: string
  userName: string
  signedIn: number
}

// What a 服务器 is called: its 备注, or else the name it gives itself.
export const nameOf = (s: Server) => s.nickname || s.name

// Why the Rust side couldn't do what was asked (emby-core's Error).
export type EmbyError =
  | { kind: 'notAnAddress' | 'offline' | 'signIn' | 'signedOut' | 'noServer' | 'storage' }
  | { kind: 'server'; status: number }

// The kept servers, read during render like the 界面语言, so a page draws them in its first frame (a 服务器's page,
// back from a 作品, is drawn full height at once, where its scroll is restored): asked for once, before the first
// render, and again after each change.
let servers: Server[] = canConnect ? await invoke<Server[]>('emby_servers').catch(() => []) : []
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const notify = () => listeners.forEach((l) => l())
const reload = () =>
  invoke<Server[]>('emby_servers').then((next) => {
    servers = next
    notify()
  })

export const useServers = () => useSyncExternalStore(subscribe, () => servers)
// what the Rust side knows a kept server by
const which = (s: Pick<Server, 'id' | 'userId'>) => ({ server: s.id, user: s.userId })

// Forgets a server; the Rust side ends its sign-in on the server too. One it couldn't forget (its file couldn't be
// written) stays in the list.
export const removeServer = (s: Server) => invoke('emby_remove', which(s)).then(reload, reload)

// Changes a kept server as its settings say; the Rust side works out what that takes (Emby::edit). One that fails
// changes nothing and rejects with why (an EmbyError). What was kept of the server's answers goes, as nothing asks
// for those under an old address again.
export const editServer = (s: Server, typed: string, username: string, password: string, nickname: string) =>
  invoke('emby_edit', { ...which(s), typed, username, password, nickname }).then(() => {
    refresh(s)
    return reload()
  })

// How a server's tile shows it: `checking` while it's asked (a grey light), `online`, `offline` when nothing Emby
// answers, `signedOut` when the server turned a kept token down (revoked, or the user is gone); and for an add that
// failed, `signIn` when the server answered the sign-in but didn't sign in (a wrong password, or an error of its own).
export type Status = 'checking' | 'online' | 'offline' | 'signedOut' | 'signIn'

// A Status in words, beside its light for anyone who can't tell red from green, and for screen readers.
export const statusText = (status: Status, t: Translate) =>
  ({
    checking: t('正在连接', 'Connecting'),
    online: t('已连接', 'Connected'),
    offline: t('连接异常', 'Connection error'),
    signedOut: t('登录已失效', 'Signed out'),
    signIn: t('登录没成功', "Couldn't sign in"),
  })[status]

// The adds under way, shown at once as tiles of their own: one that signs in turns into its server, one that fails stays
// with why until it's tried again or dismissed. Kept in this window only, as a failed add has nothing to keep. What was
// typed goes with it, the password too, so trying again starts from it rather than from nothing; it's dropped with
// the tile.
export type Adding = Pick<Server, 'name' | 'userName' | 'address'> & {
  id: number
  status: Status
  // why it failed, as the Rust side said, to tell again when it's tried again
  error?: EmbyError
  typed: string
  password: string
  nickname: string
}
let adding: Adding[] = []
let adds = 0
const setAdding = (next: Adding[]) => {
  adding = next
  notify()
}
export const useAdding = () => useSyncExternalStore(subscribe, () => adding)
export const dismiss = (a: Adding) => setAdding(adding.filter((x) => x.id !== a.id))

// Starts adding a server and returns at once, so the dialog can close. Only text that isn't an address throws (a
// TypeError), before anything shows; the Rust side reads it the same way (both parse it as a URL), then finds where the
// server answers and signs in. Trying again after a failed add (`instead`) takes that one's place.
export function addServer(typed: string, username: string, password: string, nickname: string, instead?: Adding) {
  const text = typed.trim()
  const url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`)
  const entry: Adding = {
    // a try again keeps the failed one's id, so its tile stays, and reads out how this one goes
    id: instead?.id ?? ++adds,
    name: nickname.trim() || url.host,
    userName: username,
    address: url.origin,
    status: 'checking',
    typed,
    password,
    nickname,
  }
  // in the failed one's place if it's still there, as an add of the same host and user may have cleared it meanwhile
  const at = adding.findIndex((a) => a.id === instead?.id)
  setAdding(at < 0 ? [...adding, entry] : adding.with(at, entry))
  const fail = (status: Status, error?: EmbyError) =>
    setAdding(adding.map((a) => (a.id === entry.id ? { ...a, status, error } : a)))
  invoke('emby_add', { typed, username, password, nickname })
    .then(() => invoke<Server[]>('emby_servers'))
    .then((next) => {
      // not notified on its own (as reload would): setAdding below notifies once for both, so no frame shows the server
      // beside its tile
      servers = next
      // its tile goes, and so do earlier tries at the same host and user that failed, however its address was typed
      const host = (a: Adding) => new URL(a.address).hostname
      const tried = (a: Adding) => host(a) === host(entry) && a.userName === username && a.status !== 'checking'
      setAdding(adding.filter((a) => a.id !== entry.id && !tried(a)))
    })
    // the server answered but didn't sign in, or else red rather than grey for good (unreachable, or not kept), so
    // the tile can be tried again or removed
    .catch((e?: EmbyError) => fail(e?.kind === 'signIn' || e?.kind === 'server' ? 'signIn' : 'offline', e))
}

// Whether a kept server answers its signed-in user now. Asked when the page opens, on coming back to it, and when the
// network comes or goes, as other Emby players do, rather than on a timer; a network that has just come back is given
// a moment, as its first requests can fail before it's really up. Only the latest check's answer counts, as a
// slow one can land after it. Keyed by the sign-in and the address, so a server signed in again, or moved, starts at
// `checking` rather than showing the old answer. Until its own first answer, a check starts from the last one for that
// key, so the server's page opens with the light its tile had.
const answered = new Map<string, Status>()
export function useStatus({ id, userId, signedIn, address }: Server) {
  const key = `${id}/${userId}/${signedIn}/${address}`
  const [answer, setAnswer] = useState<{ key: string; status: Status }>()
  useEffect(() => {
    let asked = 0
    const check = () => {
      if (document.hidden) return
      const n = ++asked
      invoke<Status>('emby_status', which({ id, userId }))
        .catch((): Status => 'offline')
        .then((status) => {
          if (n !== asked) return
          answered.set(key, status)
          setAnswer({ key, status })
        })
    }
    let settle: ReturnType<typeof setTimeout>
    const back = () => {
      clearTimeout(settle)
      settle = setTimeout(check, 2000)
    }
    check()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', back)
    window.addEventListener('offline', check)
    return () => {
      asked = -1
      clearTimeout(settle)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', back)
      window.removeEventListener('offline', check)
    }
  }, [key, id, userId])
  return answer?.key === key ? answer.status : (answered.get(key) ?? 'checking')
}

// Why a server couldn't be asked, or a change to it didn't go through, in words: on its page, and in its settings.
export const errorText = (e: unknown, t: Translate) => {
  const error = e as EmbyError | undefined
  switch (error?.kind) {
    case 'signedOut':
      return t(
        '登录已失效。在媒体库里打开这台服务器的设置，输入密码重新登录。',
        "Signed out. Open this server's settings in Library and enter the password to sign in again.",
      )
    case 'server':
      return t(`服务器返回错误 ${error.status}`, `The server answered with error ${error.status}`)
    case 'notAnAddress':
      return t('这不是一个服务器地址', "That isn't a server address")
    case 'signIn':
      return t('登录没成功，检查一下用户名和密码', "Couldn't sign in, check the username and password")
    case 'storage':
      return t('没能存到这台设备上', "Couldn't save it on this device")
    default:
      return t('连接异常，检查一下网络和服务器地址', "Connection error, check your network and the server's address")
  }
}

// A server's answers are kept in cache.ts under its own prefix, `emby/{server}/{user}/{address}/`, then what was
// asked: `views`, or `items/{library}/{sort}/{page}`. The address is in it as its pictures' URLs carry it, so one
// moved to another address asks again. The cache asks for a key it doesn't have by these, which read the key back.
const keyOf = (s: Server) => `emby/${s.id}/${s.userId}/${encodeURIComponent(s.address)}/`
const askViews = (key: string) => {
  const [, server, user] = key.split('/')
  return invoke<Library[]>('emby_libraries', { server, user })
}
const askItems = (key: string) => {
  const [, server, user, , , library, sort, page] = key.split('/')
  return invoke<Page>('emby_items', { server, user, library, sort, start: Number(page) * pageSize, limit: pageSize })
}

// How a 媒体库's 作品 are put in order (emby-core's Sort), which the server does, as only it has them all.
export type Sort = 'added' | 'latest' | 'oldest' | 'rating'

// The orders a 服务器's page offers, as a 分类 offers its sorts (sortsOf): 最新 turns into 最早 when pressed again,
// and back. The server knows no popularity or vote counts, so there's no 热门 or 口碑, and its 高分 can't leave out
// what only a few people rated.
export const librarySorts = (
  t: Translate,
  picked?: string | null,
): { key: Sort; flip?: Sort; label: string; hint: string }[] => [
  { key: 'added', label: t('最近添加', 'Recently Added'), hint: t('最近加到服务器上的在前', 'Most recently added first') },
  picked === 'oldest'
    ? {
        key: 'oldest',
        flip: 'latest',
        label: t('最早', 'Oldest'),
        hint: t('首映早的在前，还没首映的和没有日期的不算', 'Earliest premieres first, leaving out upcoming and undated ones'),
      }
    : {
        key: 'latest',
        flip: 'oldest',
        label: t('最新', 'Latest'),
        hint: t('首映新的在前，还没首映的和没有日期的不算', 'Latest premieres first, leaving out upcoming and undated ones'),
      },
  {
    key: 'rating',
    label: t('高分', 'Top Rated'),
    hint: t('Emby 的社区评分高的在前，只有几个人打分的也算在内', 'Highest community rating first, even if only a few people rated it'),
  },
]

// A 媒体库 as the server page shows it: its name and the 16:9 cover the server draws for it. Only those of movies and
// series come, in the server's order.
export type Library = { id: string; name: string; cover?: string }

// Drops what was kept of a server's answers, so its page asks again: entered from the 媒体库 page, it shows what was
// added or removed meanwhile, while back from a 作品 it's drawn at once from what's kept, where it was scrolled to.
export const refresh = (s: Server) => forget(keyOf(s))

export function useLibraries(s: Server) {
  const t = useT()
  const { data, failed, retry } = useAnswers<Library[]>([`${keyOf(s)}views`], askViews)
  return { libraries: data[0], error: failed && errorText(failed.error, t), retry }
}

// A 作品 as a server keeps it: its name and poster there, and the TMDB entry it is, for its page, when the server
// knows it.
type Item = { id: string; name: string; year?: number; poster?: string; tmdb?: { media_type: MediaType; id: number } }
// a page of them; the first has the count of them all
type Page = { items: Item[]; total?: number }

// The 作品 of the pages in so far, each once: pages are counted by offset, so one added while the list pages on (the
// newest added come first) pushes the last of a page onto the next.
export const itemsOf = (pages: Pick<Page, 'items'>[]) => [
  ...new Map(pages.flatMap((p) => p.items).map((i) => [i.id, i])).values(),
]

// The 作品 a 作品 page steps through: those the server knows the TMDB entry of, each once, as a 作品 kept twice (a 4K
// and a 1080p copy) would have 下一部 open itself.
export const lineupOfItems = (items: Item[]): Lineup => [
  ...new Map(
    items.flatMap((i) => (i.tmdb ? [[`${i.tmdb.media_type}/${i.tmdb.id}`, { ...i.tmdb, title: i.name }] as const] : [])),
  ).values(),
]

// as many as the poster grid's 3, 4, 5 or 6 columns fill
const pageSize = 60
// ponytail: a cap, like TMDB's, so an edited ?pages= can't ask for thousands at once; 30,000 作品 in one 媒体库. Ask
// for the first page alone and cap by its total if a library ever runs past it.
const maxPages = 500

// The first `pages` pages of a 媒体库's 作品 in `sort`'s order, as one list; like useTitles, with `total`, the 作品
// the list has, and their `lineup`. Without a server or a `library` it asks for nothing.
export function useItems(s: Server | undefined, library: string | undefined, sort: Sort, pages: number) {
  const t = useT()
  const keys =
    s && library ? Array.from({ length: Math.min(pages, maxPages) }, (_, i) => `${keyOf(s)}items/${library}/${sort}/${i}`) : []
  const { data, failed, retry } = useAnswers<Page>(keys, askItems)
  const arrived = useMemo(() => arrivedOf(data), [data])
  const items = useMemo(() => (arrived.length ? itemsOf(arrived) : undefined), [arrived])
  const lineup = useMemo(() => items && lineupOfItems(items), [items])
  const total = arrived[0]?.total
  return {
    items,
    total,
    lineup,
    loading: arrived.length < keys.length,
    // none past the cap, where one page more would ask for nothing new
    more: total !== undefined && keys.length < maxPages && keys.length * pageSize < total,
    error: failed && errorText(failed.error, t),
    retry,
  }
}

// A 媒体库 as a 作品 page opened from it knows it: its server, user and id, its order, and the pages its grid showed.
export type Shelf = { server: string; user: string; library: string; sort: Sort; pages: number }

// The 媒体库's lineup with one page more than its grid showed, for 下一部 past the last card loaded there. Without a
// `shelf`, or with its server removed meanwhile, it asks for nothing.
export function useLineupAfter(shelf: Shelf | undefined) {
  const s = useServers().find((x) => x.id === shelf?.server && x.userId === shelf?.user)
  return useItems(s, shelf?.library, shelf?.sort ?? 'added', (shelf?.pages ?? 0) + 1)
}
