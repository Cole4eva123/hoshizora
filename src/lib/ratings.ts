import axios from 'axios'
import { useEffect, useState } from 'react'
import { type Media, originalTitleOf, titleOf, yearOf } from '@/lib/tmdb'

const mdblistKey: string | undefined = import.meta.env.VITE_MDBLIST_KEY
export const hasMdblistKey = Boolean(mdblistKey)

export type Ratings = { imdb?: number; tomatoes?: number; douban?: number; mal?: number }

type MdbList = { ratings: { source: string; value: number | null }[] }

// MDBList aggregates IMDb, Rotten Tomatoes and MyAnimeList: one request per title.
async function mdblist(m: Media): Promise<Ratings> {
  if (!mdblistKey) return {}
  const type = m.media_type === 'tv' ? 'show' : 'movie'
  const { data } = await axios.get<MdbList>(`https://api.mdblist.com/tmdb/${type}/${m.id}`, { params: { apikey: mdblistKey } })
  const value = (source: string) => data.ratings.find((r) => r.source === source)?.value ?? undefined
  // MAL only for Japanese anime
  return { imdb: value('imdb'), tomatoes: value('tomatoes'), mal: m.original_language === 'ja' ? value('myanimelist') : undefined }
}

// ponytail: douban.com sends no CORS headers, so this goes through the Vite dev proxy (/douban) and only
// works under `bun run dev`; for the Tauri build switch to @tauri-apps/plugin-http's fetch.
type DoubanGet = <T>(path: string, params: Record<string, string>) => Promise<T>
const doubanGet: DoubanGet = (path, params) => axios.get(`/douban/j/${path}`, { params }).then((r) => r.data)

// Douban names titles its own way, so try the Chinese title, then the original one, and match on year.
// (Its search page can look up IMDb ids but throttles after a few dozen requests, so it isn't used.)
export async function douban(m: Media, get = doubanGet) {
  const year = yearOf(m)
  for (const q of new Set([titleOf(m), originalTitleOf(m)])) {
    const hit = (await get<{ id: string; year: string }[]>('subject_suggest', { q })).find((i) => i.year === year)
    if (!hit) continue
    const { subject } = await get<{ subject: { rate: string } }>('subject_abstract', { subject_id: hit.id })
    return Number(subject.rate) || undefined // '' when too few votes to score
  }
}

// ponytail: cached for the session and never retried, a failed source stays empty until reload
const cache = new Map<string, Promise<Ratings>[]>()

// Each source fills in as soon as it answers, so a slow Douban lookup doesn't hold back the rest.
export function useRatings(m: Media) {
  const [ratings, setRatings] = useState<Ratings>({})
  useEffect(() => {
    let live = true
    const key = `${m.media_type}/${m.id}`
    let sources = cache.get(key)
    if (!sources) cache.set(key, (sources = [mdblist(m), douban(m).then((douban) => ({ douban }))]))
    for (const p of sources) p.then((r) => live && setRatings((s) => ({ ...s, ...r })), () => {})
    return () => {
      live = false
    }
  }, [m])
  return ratings
}
