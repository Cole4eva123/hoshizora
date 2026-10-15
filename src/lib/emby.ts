import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { arrivedOf, ask, forget, has, useAnswers } from '@/lib/cache'
import { type Translate, useT } from '@/lib/i18n'
import { type PlayError, clockOf } from '@/lib/player'
import { type Lineup, type Media, episodeText } from '@/lib/tmdb'

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

// Why the Rust side couldn't do what was asked (emby-core's Error, one kind for each of its variants). Each kind has its
// words (errorText), which the compiler asks for once a kind is added here.
export type EmbyError =
  | {
      kind:
        | 'notAnAddress'
        | 'offline'
        | 'untrusted'
        | 'signIn'
        | 'signedOut'
        | 'moved'
        | 'refused'
        | 'noServer'
        | 'storage'
        | 'unplayable'
    }
  | { kind: 'server'; status: number }

// The kept servers, read during render like the 界面语言, so a page draws them in its first frame (a 服务器's page,
// back from a 作品, is drawn full height at once, where its scroll is restored): asked for once, before the first
// render, and again after each change.
const listServers = () => invoke<Server[]>('emby_servers')
let servers: Server[] = canConnect ? await listServers().catch(() => []) : []
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const notify = () => listeners.forEach((l) => l())
const reload = () =>
  listServers().then((next) => {
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
export const editServer = (s: Server, form: Form) =>
  invoke('emby_edit', { ...which(s), form }).then(() => {
    refresh(s)
    return reload()
  })

// How a server's tile shows it: `checking` while it's asked (a grey light), `online`, `offline` when nothing Emby
// answers, `signedOut` when the server turned a kept token down (revoked, or the user is gone), `moved` when its
// address redirects on its own host, `refused` when it turns the user away (a 403); and for an add that failed,
// `untrusted` when its https certificate isn't trusted (on adding, or since), `signIn` when the server answered the sign-in but didn't sign
// in (a wrong password, or an error of its own), `storage` when it couldn't be kept on this device.
export type Status =
  | 'checking'
  | 'online'
  | 'offline'
  | 'signedOut'
  | 'moved'
  | 'refused'
  | 'untrusted'
  | 'signIn'
  | 'storage'

// A Status in words, beside its light for anyone who can't tell red from green, and for screen readers.
export const statusText = (status: Status, t: Translate) =>
  ({
    checking: t('正在连接', 'Connecting'),
    online: t('已连接', 'Connected'),
    offline: t('连接异常', 'Connection error'),
    signedOut: t('登录已失效', 'Signed out'),
    moved: t('地址已失效', 'Address outdated'),
    refused: t('拒绝访问', 'Access denied'),
    untrusted: t('证书不受信任', 'Untrusted certificate'),
    signIn: t('登录没成功', "Couldn't sign in"),
    storage: t('没能保存', "Couldn't save"),
  })[status]

// What the dialog that adds a server, or changes one, sends: the address as typed, the user, the password and the
// 备注. Its inputs are named as emby-core's Form's fields are, so what's typed goes to the Rust side as it is.
export type Form = { address: string; username: string; password: string; nickname: string }

// The adds under way, shown at once as tiles of their own: one that signs in turns into its server, one that fails stays
// with why until it's tried again or dismissed. Kept in this window only, as a failed add has nothing to keep. What was
// typed (`form`) goes with it, the password too, so trying again starts from it rather than from nothing; it's dropped
// with the tile.
export type Adding = Pick<Server, 'name' | 'userName' | 'address'> & {
  id: number
  status: Status
  // why it failed, as the Rust side said, to tell again when it's tried again
  error?: EmbyError
  form: Form
}
let adding: Adding[] = []
let adds = 0
const setAdding = (next: Adding[]) => {
  adding = next
  notify()
}
export const useAdding = () => useSyncExternalStore(subscribe, () => adding)
export const dismiss = (a: Adding) => setAdding(adding.filter((x) => x.id !== a.id))

// How a failed add's tile shows why; anything else is `offline`.
const failedAs: Partial<Record<EmbyError['kind'], Status>> = {
  untrusted: 'untrusted',
  signIn: 'signIn',
  server: 'signIn',
  storage: 'storage',
}

// Starts adding a server and returns at once, so the dialog can close. Only text that isn't an address throws (a
// TypeError), before anything shows; the Rust side reads it the same way (both parse it as a URL), then finds where the
// server answers and signs in. Trying again after a failed add (`instead`) takes that one's place.
export function addServer(form: Form, instead?: Adding) {
  const text = form.address.trim()
  const url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`)
  const entry: Adding = {
    // a try again keeps the failed one's id, so its tile stays, and reads out how this one goes
    id: instead?.id ?? ++adds,
    name: form.nickname.trim() || url.host,
    userName: form.username,
    address: url.origin,
    status: 'checking',
    form,
  }
  // in the failed one's place if it's still there, as an add of the same host and user may have cleared it meanwhile
  const at = adding.findIndex((a) => a.id === instead?.id)
  setAdding(at < 0 ? [...adding, entry] : adding.with(at, entry))
  const fail = (status: Status, error?: EmbyError) =>
    setAdding(adding.map((a) => (a.id === entry.id ? { ...a, status, error } : a)))
  invoke('emby_add', { form })
    .then(listServers)
    .then((next) => {
      // not notified on its own (as reload would): setAdding below notifies once for both, so no frame shows the server
      // beside its tile
      servers = next
      // its tile goes, and so do earlier tries at the same host and user that failed, however its address was typed
      const host = (a: Adding) => new URL(a.address).hostname
      const tried = (a: Adding) => host(a) === host(entry) && a.userName === form.username && a.status !== 'checking'
      setAdding(adding.filter((a) => a.id !== entry.id && !tried(a)))
    })
    // red rather than grey for good, so the tile can be tried again or removed
    .catch((e?: EmbyError) => fail((e && failedAs[e.kind]) ?? 'offline', e))
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
  const offline = t('连接异常，检查一下网络和服务器地址', "Connection error, check your network and the server's address")
  switch (error?.kind) {
    case 'signedOut':
      return t(
        '登录已失效。在媒体库里打开这台服务器的设置，输入密码重新登录。',
        "Signed out. Open this server's settings in Library and enter the password to sign in again.",
      )
    case 'moved':
      return t(
        '服务器已经不在这个地址了。在媒体库里打开这台服务器的设置，改成它现在的地址。',
        "The server isn't at this address any more. Open its settings in Library and change it to where it is now.",
      )
    case 'refused':
      return t('服务器拒绝了访问（403）', 'The server refused access (403)')
    case 'server':
      return t(`服务器返回错误 ${error.status}`, `The server answered with error ${error.status}`)
    case 'untrusted':
      return t(
        '服务器的 https 证书不受信任（自签、过期或不是这个域名的），所以没有连上。证书过期的话，要在服务器那边更新。',
        "The server's https certificate isn't trusted (self-signed, expired, or another name's), so the app didn't connect. An expired one needs renewing on the server.",
      )
    case 'notAnAddress':
      return t('这不是一个服务器地址', "That isn't a server address")
    case 'signIn':
      return t('登录没成功，检查一下用户名和密码', "Couldn't sign in, check the username and password")
    case 'unplayable':
      return t('这个版本要服务器转码才能播放，放映室不转码', "This version plays only transcoded by the server, which Hoshizora doesn't ask for")
    case 'storage':
      return t(
        '没能存到这台设备上。看看磁盘是不是满了、放映室的数据文件夹能不能读写，再重开放映室。',
        "Couldn't save it on this device. Check the disk isn't full and Hoshizora's data folder is writable, then reopen.",
      )
    case 'offline':
    case 'noServer':
    case undefined:
      return offline
    default:
      // a kind added to EmbyError without its words fails to compile here; one only the Rust side knows reads as offline
      error satisfies never
      return offline
  }
}

// Why a version couldn't be opened, in words: what Emby said, or that the player itself couldn't start.
export const playErrorText = (e: PlayError | undefined, t: Translate) =>
  e?.kind === 'player' ? t('播放器没能打开', "The player couldn't start") : errorText(e, t)

// A server's answers are kept in cache.ts under its own prefix, `emby/{server}/{user}/{address}/`, then what was
// asked: `views`, `items/{library}/{sort}/{page}`, a 作品's `sources/{type}/{tmdb}`, a series'
// `episodes/{series}/{season}`, what the server read of a file, `versions/{item}`, or the 继续观看, `resume/{n}` (asked
// again n times). The address is in it as its pictures' URLs carry it, so one moved to another address asks again. The
// cache asks for a key it doesn't have by these, which read the key back.
const keyOf = (s: Server) => `emby/${s.id}/${s.userId}/${encodeURIComponent(s.address)}/`
// a key read back: its server and user (what the Rust side knows the server by), and the parts of what was asked after
// its name (`items/{library}/{sort}/{page}`: library, sort, page)
const askedIn = (key: string) => {
  const [, server, user, , , ...asked] = key.split('/')
  return { server, user, asked }
}
const askViews = (key: string) => {
  const { server, user } = askedIn(key)
  return invoke<Library[]>('emby_libraries', { server, user })
}
const askItems = (key: string) => {
  const { server, user, asked: [library, sort, page] } = askedIn(key)
  return invoke<Page>('emby_items', { server, user, library, sort, start: Number(page) * pageSize, limit: pageSize })
}
const askSources = (key: string) => {
  const { server, user, asked: [mediaType, id] } = askedIn(key)
  return invoke<Source[]>('emby_sources', { server, user, mediaType, id: Number(id) })
}
const askEpisodes = (key: string) => {
  const { server, user, asked: [series, season] } = askedIn(key)
  return invoke<EpisodeSource[]>('emby_episodes', { server, user, series, season: Number(season) })
}
const askVersions = (key: string) => {
  const { server, user, asked: [item] } = askedIn(key)
  return invoke<Version[]>('emby_versions', { server, user, item })
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
type Item = { id: string; name: string; year?: number; poster?: string; tmdb?: Pick<Media, 'media_type' | 'id'> }
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
  const t = useT()
  const s = useServers().find((x) => x.id === shelf?.server && x.userId === shelf?.user)
  // in the 媒体库's first order where the entry carries none, as one saved before it did
  return useItems(s, shelf?.library, shelf?.sort ?? librarySorts(t)[0].key, (shelf?.pages ?? 0) + 1)
}

// Where a 作品 can be played on a 服务器 (emby-core's sources): its 片源 there, the versions of each, and each version's
// 音轨 and 字幕 by their index in the file. A version the server hasn't read yet (a .strm) has no `video`, `bitrate` or
// tracks. `file` is its file's name, as on the server's disk or in a .strm's link (URI-encoded there). `plays` when
// the player can play it, from its own link or through the server; one only transcoded it can't.
export type Track = {
  index: number
  language?: string
  title?: string
  codec?: string
  channels?: number
  default: boolean
  forced: boolean
}
export type Version = {
  id: string
  name: string
  plays: boolean
  file?: string
  bitrate?: number
  video?: { width: number; height: number; range?: string }
  audio: Track[]
  subtitles: Track[]
}
// a movie's comes with its versions; a series' with its seasons there, its episodes asked a season at a time
export type Source = { item: string; name: string; seasons?: number; versions: Version[] }
// an episode on a series' 片源, numbered as the server numbers it; `last` for a file holding several (S01E01-E02)
export type EpisodeSource = { item: string; season: number; episode: number; last?: number; versions: Version[] }

// A 片源 found, with its server.
export type ServerSource = { s: Server; src: Source }
// A server asked for a 作品's 片源: its answer, none where it doesn't have the 作品, or why it couldn't be asked.
export type Answer = { s: Server; sources?: Source[]; error?: string }
const isAnswered = (a: Answer) => !!a.sources || !!a.error

// The 片源 of a 作品 on each of `servers`, found by its TMDB entry, all asked at once: each server's `answers` in the
// servers' order; the 片源 `found` so far; whether some are still `searching`; those `down` that couldn't be asked,
// and `retry` for them.
export function useSources(servers: Server[], m: Pick<Media, 'media_type' | 'id'>) {
  const t = useT()
  const keys = servers.map((s) => `${keyOf(s)}sources/${m.media_type}/${m.id}`)
  const { data, failed, retry } = useAnswers<Source[]>(keys, askSources)
  const answers = servers.map((s, i): Answer => {
    // failed, unless an answer has come in since (another page asked for it)
    const down = !data[i] && !!failed && keys[i] in failed.of
    return { s, sources: data[i], error: down ? errorText(failed.of[keys[i]], t) : undefined }
  })
  return {
    answers,
    found: answers.flatMap(({ s, sources }) => (sources ?? []).map((src): ServerSource => ({ s, src }))),
    searching: !answers.every(isAnswered),
    down: answers.filter((a) => a.error),
    retry,
  }
}

// The 片源 to show, and whether it's the very one wanted (`exact`, which has its file read at once). The one wanted
// (picked here, or the one the 作品 was opened from on a 服务器's page) on its server, waiting for that server to
// answer; else that server's first that plays (a step from its page names the server only). With none wanted, or that
// server without one that plays, the first found that plays (a series' with episodes), or any once no server is still
// asked. Two servers may number their items alike, so the server counts too.
export function pickOf(answers: Answer[], wanted?: { server?: string; user?: string; item?: string }) {
  const there = answers.find(({ s }) => s.id === wanted?.server && s.userId === wanted.user)
  if (there && !isAnswered(there)) return {}
  const exact = there?.sources?.find((src) => src.item === wanted?.item)
  const plays = (src: Source) => src.seasons !== 0
  const src = exact ?? there?.sources?.find(plays)
  if (there && src) return { pick: { s: there.s, src }, exact: !!exact }
  const found = answers.flatMap(({ s, sources }) => (sources ?? []).map((src): ServerSource => ({ s, src })))
  return { pick: found.find(({ src }) => plays(src)) ?? (answers.every(isAnswered) ? found[0] : undefined) }
}

// A season's episodes on a series' 片源; without one it asks for nothing.
export function useEpisodes(s: Server | undefined, series: string | undefined, season: number) {
  const t = useT()
  const keys = s && series ? [`${keyOf(s)}episodes/${series}/${season}`] : []
  const { data, failed, retry } = useAnswers<EpisodeSource[]>(keys, askEpisodes)
  return { episodes: data[0], error: failed && errorText(failed.error, t), retry }
}

const versionsKey = (s: Server, item: string) => `${keyOf(s)}versions/${item}`
// whether the server has yet to read a version's file, as for a .strm: its picture and tracks aren't in
const unread = (versions: Version[]) => !versions.length || versions.some((v) => !v.video)
const readAhead = (s: Server, item: string, versions: Version[]) => {
  if (unread(versions)) ask(versionsKey(s, item), askVersions).catch(() => {}) // asked again on its pick
}

// A pick, a pointer or the focus resting on one, not passing over it on the way elsewhere, as arrow keys pick each
// radio they pass in a row.
const rest = 400

// A 片源's or an episode's handlers that have the server read its file ahead of its pick, as a .strm takes it about
// 5 s the first time: when the pointer or the focus rests on it. Only that one, never all a page shows, as the server
// reads it from the cloud. One pointer and one focus, so one wait for each. One read already asks nothing.
const resting: { pointer?: ReturnType<typeof setTimeout>; focus?: ReturnType<typeof setTimeout> } = {}
const wait = (by: keyof typeof resting, s: Server, item: string, versions: Version[]) => () => {
  clearTimeout(resting[by])
  resting[by] = setTimeout(() => readAhead(s, item, versions), rest)
}
const stop = (by: keyof typeof resting) => () => clearTimeout(resting[by])
export const readAheadOn = (s: Server, item: string, versions: Version[]) => ({
  onPointerEnter: wait('pointer', s, item, versions),
  onPointerLeave: stop('pointer'),
  onFocus: wait('focus', s, item, versions),
  onBlur: stop('focus'),
})

// A 片源's or an episode's versions, with their tracks: read by the server if it hasn't yet and they're `wanted`,
// `reading` meanwhile, and `error` when it couldn't be, as when the server is down; one the server can't read stays as it
// was, without tracks. Without an item it asks for nothing.
export function useVersions(s: Server | undefined, item: string | undefined, versions: Version[], wanted: boolean) {
  const t = useT()
  const key = s && item ? versionsKey(s, item) : ''
  // asked once the item has rested 400 ms, as arrow keys pick each radio they pass; read ahead already, at once
  const [rested, setRested] = useState<string>()
  useEffect(() => {
    const id = setTimeout(() => setRested(key), rest)
    return () => clearTimeout(id)
  }, [key])
  const keys = key && unread(versions) && ((wanted && rested === key) || has(key)) ? [key] : []
  const { data, failed, retry } = useAnswers<Version[]>(keys, askVersions)
  const read = data[0]
  return {
    versions: read?.length ? read : versions,
    // from the moment they're wanted, through the rest before asking
    reading: !!key && unread(versions) && (wanted || keys.length > 0) && !read && !failed,
    error: failed && errorText(failed.error, t),
    retry,
  }
}

// A 继续观看 on a 服务器 (emby-core's Resume): a movie or an episode started there and not finished, its name (and for an
// episode its series', the series' item there and its numbers), the TMDB entry of the movie or the series, for its page, a 16:9 剧照,
// where it was left off and how long it is (seconds; unknown for a .strm the server hasn't read), and when it was last
// played (ISO 8601, in UTC).
export type Resume = {
  item: string
  name: string
  series?: string
  seriesItem?: string
  season?: number
  episode?: number
  year?: number
  tmdb?: Pick<Media, 'media_type' | 'id'>
  still?: string
  position: number
  runtime?: number
  played?: string
}
// one with its server
type ServerResume = { s: Server; r: Resume }

// Each server's 继续观看 as one list, the last played first, whichever server it was on; one with no date goes last.
const playedAt = (r: Resume) => Date.parse(r.played ?? '') || 0
export const resumesOf = (lists: { s: Server; resumes?: Resume[] }[]): ServerResume[] =>
  lists.flatMap(({ s, resumes }) => (resumes ?? []).map((r) => ({ s, r }))).sort((a, b) => playedAt(b.r) - playedAt(a.r))

// A 继续观看's episode in words (第 1 季第 5 集), none for a movie: with its season, as how many seasons a series has
// (which the 作品 page goes by, naming none for one) isn't known here.
export const episodeOf = (r: Resume, t: Translate) =>
  r.series && r.episode !== undefined ? episodeText({ season: r.season, episode: r.episode }, t) : undefined

// A 继续观看 as the player's window names it: the movie, or the series and the episode.
export const resumeTitle = (r: Resume, t: Translate) => {
  const episode = episodeOf(r, t)
  return episode ? `${r.series} · ${episode}` : r.name
}

// What's left of a 继续观看, in words (还剩 1 小时 5 分钟); its length unknown, where it was left off (看到 20:43).
export const leftOf = ({ position, runtime }: Pick<Resume, 'position' | 'runtime'>, t: Translate) => {
  if (!runtime) return t(`看到 ${clockOf(position)}`, `At ${clockOf(position)}`)
  const m = Math.max(1, Math.round((runtime - position) / 60))
  const [h, min] = [Math.floor(m / 60), m % 60]
  const left = !h ? t(`${m} 分钟`, `${m} min`) : min ? t(`${h} 小时 ${min} 分钟`, `${h} h ${min} min`) : t(`${h} 小时`, `${h} h`)
  return t(`还剩 ${left}`, `${left} left`)
}

// Each server's 继续观看 as last answered, by its prefix (keyOf, the address in it, as the pictures' URLs carry it): shown
// while it's asked again, so the row doesn't empty meanwhile and a page drawn again (back from a 作品) draws it in its
// first frame. The one exception to a hook's answers being its own request's: the same list, asked again.
const lastResumes = new Map<string, Resume[]>()
const atOf = (s: Pick<Server, 'id' | 'userId'>) => `${s.id}/${s.userId}`
const askResume = (key: string) => {
  const { server, user, asked: [, n] } = askedIn(key)
  return invoke<Resume[]>('emby_resume', { server, user }).then((resumes) => {
    // not one asked before it that answers after it
    if (Number(n) === (again.get(atOf({ id: server, userId: user })) ?? 0))
      lastResumes.set(key.slice(0, key.lastIndexOf('resume/')), resumes)
    return resumes
  })
}

// How many times each server's list has been asked again, its key's last part, as the cache keeps an answer for good;
// `asked` counts them all, for the hooks to hear.
const again = new Map<string, number>()
let asked = 0
const resumeKey = (s: Server) => `${keyOf(s)}resume/${again.get(atOf(s)) ?? 0}`
// Asks these servers' 继续观看 again now, whether a row shows it or not: the last answer forgotten (its list shown
// meanwhile), the next asked under a key of its own.
const askAgain = (these: Server[]) => {
  for (const s of these) {
    forget(resumeKey(s))
    again.set(atOf(s), (again.get(atOf(s)) ?? 0) + 1)
    ask(resumeKey(s), askResume).catch(() => {}) // asked again by the row that shows it
  }
  asked++
  notify()
}
if (canConnect) {
  // a stop the player has told a server of (src-tauri/src/player/report.rs); not heard, the rows change as the window
  // comes back
  listen<{ server: string; user: string }>('emby://resume', ({ payload }) =>
    askAgain(servers.filter((s) => s.id === payload.server && s.userId === payload.user)),
  ).catch(console.error)
  // the window brought back, as what was watched elsewhere meanwhile (another of Emby's apps) shows here too; at most
  // every 30 s, as switching apps brings it back often
  let back = 0
  window.addEventListener('focus', () => {
    if (Date.now() - back < 30_000) return
    back = Date.now()
    askAgain(servers)
  })
}

// The 继续观看 of each of `servers` as one list, the last played first, each server's as it answers, or its last while
// it's asked again. `down`: those that couldn't be asked, with why.
export function useResume(servers: Server[]) {
  const t = useT()
  useSyncExternalStore(subscribe, () => asked)
  const keys = servers.map(resumeKey)
  const { data, failed, retry } = useAnswers<Resume[]>(keys, askResume)
  const lists = servers.map((s, i) => {
    const down = !data[i] && !!failed && keys[i] in failed.of
    return { s, resumes: data[i] ?? lastResumes.get(keyOf(s)), error: down ? errorText(failed.of[keys[i]], t) : undefined }
  })
  return { resumes: resumesOf(lists), down: lists.filter((l) => l.error), retry }
}
