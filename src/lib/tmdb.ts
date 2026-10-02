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

export const titleOf = (m: Media) => m.title ?? m.name ?? ''
export const originalTitleOf = (m: Media) => m.original_title ?? m.original_name ?? ''
export const yearOf = (m: Media) => (m.release_date ?? m.first_air_date ?? '').slice(0, 4)
export const img = (path: string | null, size: 'w300' | 'w342' | 'w1280') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined

const errorText = (e: unknown) => {
  if (!axios.isAxiosError(e)) return e instanceof Error ? e.message : String(e)
  if (e.response?.status === 401) return 'TMDB 令牌无效，检查 VITE_TMDB_TOKEN'
  return e.response ? `TMDB 返回错误 ${e.response.status}` : '连不上 TMDB，检查一下网络'
}

// ponytail: cached for the whole session, add a TTL if long sessions show stale rows
const cache = new Map<string, Promise<unknown>>()

function load(path: string) {
  let p = cache.get(path)
  if (!p) {
    p = token ? api.get(path).then((r) => r.data) : Promise.reject(new Error('还没有配置 TMDB 令牌'))
    p.catch(() => cache.delete(path)) // failed requests retry on next mount
    cache.set(path, p)
  }
  return p
}

export function useTmdb<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: string }>({})
  useEffect(() => {
    let live = true
    load(path).then(
      (data) => live && setState({ data: data as T }),
      (e) => live && setState({ error: errorText(e) }),
    )
    return () => {
      live = false
    }
  }, [path])
  return state
}
