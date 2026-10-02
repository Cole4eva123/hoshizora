import axios from 'axios'
import { useEffect, useState } from 'react'

const token: string | undefined = import.meta.env.VITE_TMDB_TOKEN
export const hasToken = Boolean(token)

const api = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  headers: { Authorization: `Bearer ${token}` },
  params: { language: 'zh-CN' },
})

export type Media = {
  id: number
  media_type?: 'movie' | 'tv' | 'person'
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  vote_average: number
  original_language?: string
  release_date?: string
  first_air_date?: string
}

export type MediaList = { results: Media[] }

// Home rows. A row shows the first page of its request (20 titles), so its length is fixed.
export const categories = [
  { key: 'movie', title: '电影', path: '/trending/movie/week' },
  { key: 'kdrama', title: '韩剧', path: '/discover/tv?with_original_language=ko&with_genres=18&without_genres=16' },
  { key: 'us', title: '美剧', path: '/discover/tv?with_origin_country=US&with_genres=18&without_genres=16' },
  { key: 'cdrama', title: '国产剧', path: '/discover/tv?with_origin_country=CN&with_genres=18&without_genres=16' },
  { key: 'jdrama', title: '日剧', path: '/discover/tv?with_original_language=ja&with_genres=18&without_genres=16' },
  { key: 'anime', title: '动画', path: '/discover/tv?with_genres=16' },
  { key: 'doc', title: '纪录片', path: '/discover/movie?with_genres=99' },
]

export type Category = (typeof categories)[number]
export type MediaType = 'movie' | 'tv'

// Discover results carry no media_type, so a row's type comes from its endpoint.
export const typeOf = (c: Category): MediaType => (c.path.includes('/tv') ? 'tv' : 'movie')

export const titleOf = (m: Media) => m.title ?? m.name ?? ''
export const originalTitleOf = (m: Media) => m.original_title ?? m.original_name ?? ''
export const yearOf = (m: Media) => (m.release_date ?? m.first_air_date ?? '').slice(0, 4)
export const img = (path: string | null, size: 'w300' | 'w342' | 'w500' | 'w1280') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined

export type Episode = {
  id: number
  season_number: number
  episode_number: number
  name: string
  overview: string
  air_date: string | null
  runtime: number | null
  still_path: string | null
}

// A movie or show with images and credits appended. The season and episode fields are TV only.
export type Details = Media & {
  genres: { id: number; name: string }[]
  runtime?: number
  status: string
  number_of_seasons?: number
  number_of_episodes?: number
  seasons?: { id: number; season_number: number; name: string }[]
  next_episode_to_air?: Episode | null
  last_episode_to_air?: Episode | null
  images: { backdrops: { file_path: string }[] }
  credits: { cast: { credit_id: string; name: string; character: string; profile_path: string | null }[] }
}

export type Logo = { file_path: string; iso_639_1: string | null; iso_3166_1: string | null }

// A title's own lettering: Simplified Chinese first, then the original language, then English, then any.
export function pickLogo(logos: Logo[], originalLanguage?: string) {
  const find = (lang?: string, region?: string) =>
    logos.find((l) => l.iso_639_1 === lang && (!region || l.iso_3166_1 === region))
  return find('zh', 'CN') ?? find(originalLanguage) ?? find('en') ?? logos[0]
}

export function useLogo(m: Media) {
  const { data, error } = useTmdb<{ logos: Logo[] }>(
    `/${m.media_type}/${m.id}/images?include_image_language=zh,${m.original_language},en,null`,
  )
  return { ready: Boolean(data || error), logo: data && pickLogo(data.logos, m.original_language) }
}

// Some logos are drawn dark for light posters and vanish on the dark wall. Takes RGBA pixels; true when the
// average colour of the opaque ink has under ~1.5:1 contrast against the background, i.e. practically invisible.
export function isDarkInk(px: Uint8ClampedArray) {
  let [r, g, b, n] = [0, 0, 0, 0]
  for (let i = 0; i < px.length; i += 4)
    if (px[i + 3] > 127) {
      r += px[i]
      g += px[i + 1]
      b += px[i + 2]
      n++
    }
  const linear = (sum: number) => {
    const v = sum / n / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return n > 0 && 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) < 0.036
}

// Air dates are calendar days, so count whole days from today's date rather than from the clock.
export const dayOf = (date: string) => new Date(`${date}T00:00`)
export const daysUntil = (date: string, now = new Date()) =>
  Math.round((dayOf(date).getTime() - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
export const airDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
export const relativeDays = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

// When the next episode comes out, or why there isn't one.
export function nextEpisodeText(tv: Details, now = new Date()) {
  const seasons = tv.number_of_seasons ?? 1
  const next = tv.next_episode_to_air
  if (next) {
    const ep = seasons > 1 ? `第 ${next.season_number} 季第 ${next.episode_number} 集` : `第 ${next.episode_number} 集`
    if (!next.air_date) return `下一集：${ep}，播出时间还没公布`
    return `下一集：${ep}，${airDate.format(dayOf(next.air_date))}播出（${relativeDays.format(daysUntil(next.air_date, now), 'day')}）`
  }
  const done = ({ Ended: '已完结', Canceled: '已停播' } as Record<string, string>)[tv.status]
  if (!done) return '下一集的播出时间还没公布'
  return `${done}，共 ${seasons > 1 ? `${seasons} 季 ` : ''}${tv.number_of_episodes} 集`
}

const errorText = (e: unknown) => {
  if (!axios.isAxiosError(e)) return e instanceof Error ? e.message : String(e)
  if (e.response?.status === 401) return 'TMDB 令牌无效，检查 VITE_TMDB_TOKEN'
  return e.response ? `TMDB 返回错误 ${e.response.status}` : '连不上 TMDB，检查一下网络'
}

// ponytail: cached for the whole session, add a TTL if long sessions show stale rows
const cache = new Map<string, Promise<unknown>>()

function getTmdb<T>(path: string) {
  let p = cache.get(path)
  if (!p) {
    p = token ? api.get(path).then((r) => r.data) : Promise.reject(new Error('还没有配置 TMDB 令牌'))
    p.catch(() => cache.delete(path)) // failed requests retry on next mount
    cache.set(path, p)
  }
  return p as Promise<T>
}

export function useTmdb<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: string }>({})
  useEffect(() => {
    let live = true
    getTmdb<T>(path).then(
      (data) => live && setState({ data }),
      (e) => live && setState({ error: errorText(e) }),
    )
    return () => {
      live = false
    }
  }, [path])
  return state
}
