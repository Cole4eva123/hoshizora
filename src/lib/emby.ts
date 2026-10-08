import axios, { isAxiosError } from 'axios'
import { useEffect, useState, useSyncExternalStore } from 'react'
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

// The address every request goes under, from what was typed: http:// when no scheme is given, and Emby's 8096 when no
// port either, as most servers are reached by IP at home; a typed scheme is kept as is. The web client's page goes, as
// its address is the one people copy. Every route goes under /emby, which a server answers directly too, and which a
// reverse proxy may forward and nothing else.
export function baseOf(typed: string) {
  const text = typed.trim()
  const schemed = /^https?:\/\//i.test(text)
  const url = new URL(schemed ? text : `http://${text}`)
  // read off the text, as URL drops a typed :80
  if (!schemed && !/:\d+(\/|$)/.test(text)) url.port = '8096'
  const path = url.pathname.replace(/\/web(\/.*)?$/, '').replace(/\/+$/, '')
  return url.origin + (path.endsWith('/emby') ? path : `${path}/emby`)
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
const changed = (next: Server[]) => {
  servers = next
  listeners.forEach((l) => l())
}
globalThis.addEventListener?.('storage', (e) => e.key === key && changed(read()))
function save(next: Server[]) {
  storage?.setItem(key, JSON.stringify(next))
  changed(next)
}

export const useServers = () => useSyncExternalStore(subscribe, () => servers)
const same = (a: Server) => (b: Server) => a.id === b.id && a.userId === b.userId

// Signs out on the server too, so the token stops working there; a server that doesn't answer keeps it until it ends
// the session itself.
export function removeServer(s: Server) {
  axios.post(`${s.address}/Sessions/Logout`, null, { params: { ...client, 'X-Emby-Token': s.token } }).catch(() => {})
  save(servers.filter((x) => !same(s)(x)))
}

// Why a server couldn't be added: nothing Emby answers at the address, an https page can't call an http server (the
// web version on GitHub Pages), or the server turned the sign-in down.
export class AddError extends Error {
  reason
  constructor(reason: 'unreachable' | 'insecure' | 'signIn') {
    super(reason)
    this.reason = reason
  }
}

// Checks the address, signs in, and keeps the server, in place of an earlier sign-in as the same user.
export async function addServer(typed: string, username: string, password: string, nickname: string) {
  let address: string
  let info: { Id: string; ServerName: string }
  try {
    address = baseOf(typed)
    info = (await axios.get(`${address}/System/Info/Public`, { timeout: 5000 })).data
    if (!info.Id) throw new Error('not an Emby server')
  } catch {
    // an address typed without a scheme is asked over http too
    const insecure = location.protocol === 'https:' && !/^https:/i.test(typed.trim())
    throw new AddError(insecure ? 'insecure' : 'unreachable')
  }
  let server: Server
  try {
    const { data } = await axios.post(
      `${address}/Users/AuthenticateByName`,
      { Username: username, Pw: password },
      { params: client, timeout: 10000 },
    )
    // read in here, as a proxy's login page can answer 200 in place of Emby
    server = {
      id: info.Id,
      name: info.ServerName,
      nickname: nickname.trim() || undefined,
      address,
      userId: data.User.Id,
      userName: data.User.Name,
      token: data.AccessToken,
    }
  } catch (e) {
    // a server that answered at all turned the sign-in down (a wrong password, or a disabled user)
    throw new AddError(isAxiosError(e) && e.response ? 'signIn' : 'unreachable')
  }
  // signing in again, as after 登录已失效, keeps the 备注 unless a new one is typed
  server.nickname ||= servers.find(same(server))?.nickname
  save([...servers.filter((s) => !same(server)(s)), server])
}

// Whether a server answers its signed-in user now, asked on mount, every 30 s, and on coming back to the tab:
// `signedOut` when the server turned the token down (revoked, or the user is gone), `offline` when nothing answers. Only
// the latest check's answer counts, as a slow one can land after it. Keyed by the token, so a server signed in again
// starts at `checking` rather than showing the old sign-in's answer.
type Status = 'checking' | 'online' | 'offline' | 'signedOut'
export function useStatus({ address, token }: Server) {
  const [answer, setAnswer] = useState<{ token: string; status: Status }>()
  useEffect(() => {
    let asked = 0
    const check = () => {
      if (document.hidden) return
      const n = ++asked
      axios
        .get(`${address}/System/Info`, { params: { ...client, 'X-Emby-Token': token }, timeout: 5000 })
        .then(
          (): Status => 'online',
          (e): Status => (isAxiosError(e) && e.response?.status === 401 ? 'signedOut' : 'offline'),
        )
        .then((status) => n === asked && setAnswer({ token, status }))
    }
    check()
    const timer = setInterval(check, 30_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      asked = -1
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [address, token])
  return answer?.token === token ? answer.status : 'checking'
}
