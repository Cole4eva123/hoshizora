import axios, { isAxiosError } from 'axios'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { arrivedOf, forget, useAnswers } from '@/lib/cache'
import { type Translate, useT } from '@/lib/i18n'
import type { Lineup, MediaType } from '@/lib/tmdb'
import { storage } from '@/lib/utils'

// A 服务器 as kept on this device: where it is, who signed in, the token that sign-in gave, and its 备注 if the user
// gave one. The password is never kept. One server signed in as two users is two entries.
// ponytail: tokens sit in localStorage, readable by any script on the origin, which on GitHub Pages is every Pages site
// of the account; move them to the Keychain with Tauri.
export type Server = {
  id: string
  name: string
  nickname?: string
  address: string
  userId: string
  userName: string
  token: string
}

// What a 服务器 is called: its 备注, or else the name it gives itself.
export const nameOf = (s: Server) => s.nickname || s.name

// The addresses a server may answer at, from what was typed. A typed scheme is kept as is. Without one, https comes
// before http, so a sign-in goes encrypted wherever it can, each on the port typed, or else on Emby's (8920, 8096) and
// the scheme's own, where a reverse proxy serves it. The web client's page goes, as its address is the one people copy.
// Every route goes under /emby, which a server answers directly too, and which a reverse proxy may forward and nothing
// else.
export function candidatesOf(typed: string) {
  const text = typed.trim()
  const schemed = /^https?:\/\//i.test(text)
  const url = new URL(schemed ? text : `http://${text}`)
  const path = url.pathname.replace(/\/web(\/.*)?$/, '').replace(/\/+$/, '')
  const at = (protocol: string, port: string) => {
    const u = new URL(url)
    u.protocol = protocol
    u.port = port
    return u.origin + (path.endsWith('/emby') ? path : `${path}/emby`)
  }
  if (schemed) return [at(url.protocol, url.port)]
  // read off the host as typed, as URL drops a typed :80
  const port = text.split(/[/?#]/)[0].match(/:(\d+)$/)?.[1]
  return port
    ? [at('https:', port), at('http:', port)]
    : [at('https:', ''), at('https:', '8920'), at('http:', '8096'), at('http:', '')]
}

// Who's asking, in the query string as Emby's own client sends it since server 4.4: a header of our own would make the
// browser ask the server's CORS leave before every status check (the sign-in's JSON body asks it anyway). The device id
// is kept on first load, so tabs opened later share it; a storage that refuses it makes a new one each load.
const deviceKey = 'hoshizora.device'
const deviceId = storage?.getItem(deviceKey) ?? Math.random().toString(36).slice(2)
try {
  storage?.setItem(deviceKey, deviceId)
} catch {
  // this module loads with every page, which a full or locked storage mustn't stop
}
const client = {
  'X-Emby-Client': 'Hoshizora',
  'X-Emby-Device-Name': 'Hoshizora',
  'X-Emby-Device-Id': deviceId,
  'X-Emby-Client-Version': '1.0.0',
}
// what a signed-in request sends
const as = (token: string) => ({ ...client, 'X-Emby-Token': token })

// The saved servers, read during render like the 界面语言, so a page draws them in its first frame. This module loads
// with every page, so a list it can't read counts as none. Another tab's change is taken in, so that saving here
// doesn't write over it.
const key = 'hoshizora.servers'
const read = (): Server[] => {
  try {
    const list = JSON.parse(storage?.getItem(key) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
let servers = read()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const notify = () => listeners.forEach((l) => l())
const changed = (next: Server[]) => {
  servers = next
  notify()
}
globalThis.addEventListener?.('storage', (e) => e.key === key && changed(read()))
function save(next: Server[]) {
  storage?.setItem(key, JSON.stringify(next))
  changed(next)
}

export const useServers = () => useSyncExternalStore(subscribe, () => servers)
const same = (a: Server) => (b: Server) => a.id === b.id && a.userId === b.userId

// Ends a sign-in on the server, so its token stops working there; a server that doesn't answer keeps it until it ends
// the session itself.
const signOut = (s: Server) =>
  axios.post(`${s.address}/Sessions/Logout`, null, { params: as(s.token) }).catch(() => {})

export function removeServer(s: Server) {
  signOut(s)
  save(servers.filter((x) => !same(s)(x)))
}

// How a server's tile shows it: `checking` while it's asked (a grey light), `online`, `offline` when nothing Emby
// answers, `signedOut` when the server turned a kept token down (revoked, or the user is gone); and for an add that
// failed, `signIn` when the server turned the sign-in down, `insecure` when an https page (the web version on GitHub
// Pages) can't call an http server.
export type Status = 'checking' | 'online' | 'offline' | 'signedOut' | 'signIn' | 'insecure'

// A Status in words, beside its light for anyone who can't tell red from green, and for screen readers.
export const statusText = (status: Status, t: Translate) =>
  ({
    checking: t('正在连接', 'Connecting'),
    online: t('已连接', 'Connected'),
    offline: t('连不上', 'Unreachable'),
    signedOut: t('登录已失效', 'Signed out'),
    signIn: t('登录没成功', "Couldn't sign in"),
    insecure: t('网页版只能连 https', 'The web version needs https'),
  })[status]

// The adds under way, shown at once as tiles of their own: one that signs in turns into its server, one that fails stays
// with why until it's dismissed. Kept in this tab only, as a failed add has no token to keep.
export type Adding = Pick<Server, 'name' | 'userName' | 'address'> & { id: number; status: Status }
let adding: Adding[] = []
let adds = 0
const setAdding = (next: Adding[]) => {
  adding = next
  notify()
}
export const useAdding = () => useSyncExternalStore(subscribe, () => adding)
export const dismiss = (a: Adding) => setAdding(adding.filter((x) => x.id !== a.id))

// Starts adding a server and returns at once, so the dialog can close. Only text that isn't an address throws, before
// anything shows.
export function addServer(typed: string, username: string, password: string, nickname: string) {
  const addresses = candidatesOf(typed)
  const address = addresses[0]
  const entry: Adding = {
    id: ++adds,
    name: nickname.trim() || new URL(address).host,
    userName: username,
    address,
    status: 'checking',
  }
  setAdding([...adding, entry])
  const fail = (status: Status) => setAdding(adding.map((a) => (a.id === entry.id ? { ...a, status } : a)))
  signIn(addresses, username, password)
    .then((result) => {
      if (typeof result === 'string') return fail(result)
      // signing in again, as after 登录已失效, keeps the 备注 unless a new one is typed, and ends the old sign-in (Emby
      // may hand the same device its token back, which must stay)
      const old = servers.find(same(result))
      result.nickname = nickname.trim() || old?.nickname
      save([...servers.filter((s) => !same(result)(s)), result])
      if (old && old.token !== result.token) signOut(old)
      // its tile goes, and so do earlier tries at the same host and user that failed, however its address was typed
      const host = (a: Adding) => new URL(a.address).hostname
      const tried = (a: Adding) => host(a) === host(entry) && a.userName === username && a.status !== 'checking'
      setAdding(adding.filter((a) => a.id !== entry.id && !tried(a)))
    })
    // a storage that won't keep it: red rather than grey for good, so the tile can at least be removed
    .catch(() => fail('offline'))
}

// Finds where the server answers, then signs in there: the server to keep, or why not. The https addresses race each
// other, and the http ones only once none of those answers in 2 s, so the password goes in the clear only to a server
// whose https is that slow or missing. A home server's IP mostly turns https down at once; the short wait is for a
// firewall that drops rather than refuses, which would otherwise hold http back for the whole timeout. A redirect, as
// from a proxy's http to its https, is followed to where the server answers, and that address is the one kept.
async function signIn(addresses: string[], username: string, password: string): Promise<Server | Status> {
  const probe = (timeout: number) => (address: string) =>
    axios.get(`${address}/System/Info/Public`, { timeout }).then(({ data, request }) => {
      if (!data?.Id) throw new Error('not an Emby server')
      const landed = (request as XMLHttpRequest).responseURL?.replace(/\/System\/Info\/Public$/i, '')
      return { address: landed || address, info: data as { Id: string; ServerName: string } }
    })
  const race = (scheme: string, timeout: number) =>
    Promise.any(addresses.filter((a) => a.startsWith(scheme)).map(probe(timeout)))
  let found
  try {
    found = await race('https:', 2000).catch(() => race('http:', 5000))
  } catch {
    return location.protocol === 'https:' && addresses.some((a) => a.startsWith('http:')) ? 'insecure' : 'offline'
  }
  const { address, info } = found
  try {
    const { data } = await axios.post(
      `${address}/Users/AuthenticateByName`,
      { Username: username, Pw: password },
      { params: client, timeout: 10000 },
    )
    // read in here, as a proxy's login page can answer 200 in place of Emby
    return {
      id: info.Id,
      name: info.ServerName,
      address,
      userId: data.User.Id,
      userName: data.User.Name,
      token: data.AccessToken,
    }
  } catch (e) {
    // a server that answered at all turned the sign-in down (a wrong password, or a disabled user)
    return isAxiosError(e) && e.response ? 'signIn' : 'offline'
  }
}

// Whether a kept server answers its signed-in user now. Asked when the page opens, on coming back to it, and when the
// network comes or goes, as other Emby players do, rather than on a timer; a network that has just come back is given
// a moment, as its first requests can fail before it's really up. Only the latest check's answer counts, as a
// slow one can land after it. Keyed by the token, so a server signed in again starts at `checking` rather than showing
// the old sign-in's answer. Until its own first answer, a check starts from the last one for that sign-in, so the
// server's page opens with the light its tile had.
const answered = new Map<string, Status>()
export function useStatus({ address, token }: Server) {
  const [answer, setAnswer] = useState<{ token: string; status: Status }>()
  useEffect(() => {
    let asked = 0
    const check = () => {
      if (document.hidden) return
      const n = ++asked
      axios
        .get(`${address}/System/Info`, { params: as(token), timeout: 5000 })
        .then(
          (): Status => 'online',
          (e): Status => (isAxiosError(e) && e.response?.status === 401 ? 'signedOut' : 'offline'),
        )
        .then((status) => {
          if (n !== asked) return
          answered.set(`${address} ${token}`, status)
          setAnswer({ token, status })
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
  }, [address, token])
  return answer?.token === token ? answer.status : (answered.get(`${address} ${token}`) ?? 'checking')
}

// A server's pictures come sized down to `width`, and `tag` changes when one is replaced, so a new one isn't served
// from the browser's cache. Pictures need no token.
const imageOf = (s: Pick<Server, 'address'>, id: string, tag: string | undefined, width: number) =>
  tag && `${s.address}/Items/${id}/Images/Primary?tag=${tag}&maxWidth=${width}&quality=90`

// A 服务器's answer to a URL, asked as its signed-in user. The URL is the cache's key, so the token, which can change
// when a server is signed in again, stays out of it.
const keyOf = (s: Server) => `${s.address}/Users/${s.userId}/`
const getAs = (token: string) => (url: string) =>
  axios.get(url, { params: as(token), timeout: 15000 }).then((r) => r.data)

const errorText = (e: unknown, t: Translate) => {
  const status = isAxiosError(e) ? e.response?.status : undefined
  if (status === 401)
    return t('登录已失效。在媒体库里移除这台服务器，再添加一次。', 'Signed out. Remove this server in Library and add it again.')
  return status
    ? t(`服务器返回错误 ${status}`, `The server answered with error ${status}`)
    : t('连不上这台服务器，检查一下网络', "Can't reach this server, check your connection")
}

// A 媒体库 as the server page shows it: its name and the 16:9 cover the server draws for it.
export type Library = { id: string; name: string; cover?: string }
type View = { Id: string; Name: string; CollectionType?: string; ImageTags?: { Primary?: string } }

// The 媒体库 a server shows its user, in the order set on the server. Only those of movies, series or both: music,
// photos and the like can't be played here.
export const librariesOf = (s: Pick<Server, 'address'>, views: View[]): Library[] =>
  views
    .filter((v) => !v.CollectionType || ['movies', 'tvshows', 'mixed'].includes(v.CollectionType))
    .map((v) => ({ id: v.Id, name: v.Name, cover: imageOf(s, v.Id, v.ImageTags?.Primary, 480) }))

// Drops what was kept of a server's answers, so its page asks again: entered from the 媒体库 page, it shows what was
// added or removed meanwhile, while back from a 作品 it's drawn at once from what's kept, where it was scrolled to.
export const refresh = (s: Server) => forget(keyOf(s))

export function useLibraries(s: Server) {
  const t = useT()
  const get = useMemo(() => getAs(s.token), [s.token])
  const { data, failed, retry } = useAnswers<{ Items: View[] }>([`${keyOf(s)}Views`], get)
  const libraries = useMemo(() => data[0] && librariesOf(s, data[0].Items), [s, data])
  return { libraries, error: failed && errorText(failed.error, t), retry }
}

// A 作品 as a server keeps it: its name and poster there, and the TMDB entry it is, for its page, when the server
// knows it.
type Item = { id: string; name: string; year?: number; poster?: string; tmdb?: { media_type: MediaType; id: number } }
type Listed = {
  Id: string
  Name: string
  Type: string
  ProductionYear?: number
  ImageTags?: { Primary?: string }
  ProviderIds?: { Tmdb?: string }
}

// Each once: the newest come first and are counted by offset, so one added while the list pages on pushes the last
// of a page onto the next.
export const itemsOf = (s: Pick<Server, 'address'>, listed: Listed[]): Item[] =>
  [...new Map(listed.map((i) => [i.Id, i])).values()].map((i) => {
    const tmdb = Number(i.ProviderIds?.Tmdb)
    return {
      id: i.Id,
      name: i.Name,
      year: i.ProductionYear,
      poster: imageOf(s, i.Id, i.ImageTags?.Primary, 342),
      tmdb: tmdb ? { media_type: i.Type === 'Series' ? 'tv' : 'movie', id: tmdb } : undefined,
    }
  })

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

// The first `pages` pages of a 媒体库's 作品, newest added first, as one list; like useTitles, with `total`, the
// 作品 the 媒体库 has, and their `lineup`. Without a `library` it asks for nothing.
export function useItems(s: Server, library: string | undefined, pages: number) {
  const t = useT()
  const pageOf = (i: number) =>
    `${keyOf(s)}Items?${new URLSearchParams({
      ParentId: library!,
      Recursive: 'true',
      IncludeItemTypes: 'Movie,Series',
      SortBy: 'DateCreated,SortName',
      // Emby takes an order for each: the newest first, and a batch added at once (a library scan) A to Z
      SortOrder: 'Descending,Ascending',
      Fields: 'ProviderIds,ProductionYear',
      EnableImageTypes: 'Primary',
      ImageTypeLimit: '1',
      EnableUserData: 'false',
      StartIndex: `${i * pageSize}`,
      Limit: `${pageSize}`,
      // only the first page's count is read, and counting a large 媒体库 is work for the server
      EnableTotalRecordCount: `${i === 0}`,
    })}`
  const urls = library ? Array.from({ length: Math.min(pages, maxPages) }, (_, i) => pageOf(i)) : []
  const get = useMemo(() => getAs(s.token), [s.token])
  const { data, failed, retry } = useAnswers<{ Items: Listed[]; TotalRecordCount: number }>(urls, get)
  const arrived = useMemo(() => arrivedOf(data), [data])
  const items = useMemo(() => (arrived.length ? itemsOf(s, arrived.flatMap((p) => p.Items)) : undefined), [s, arrived])
  const lineup = useMemo(() => items && lineupOfItems(items), [items])
  const total = arrived[0]?.TotalRecordCount
  return {
    items,
    total,
    lineup,
    loading: arrived.length < urls.length,
    more: total !== undefined && urls.length * pageSize < total,
    error: failed && errorText(failed.error, t),
    retry,
  }
}
