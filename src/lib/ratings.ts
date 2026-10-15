import axios from 'axios'
import { useEffect, useState } from 'react'
import type { Copy } from '@/lib/i18n'
import { checked, apiKeyOf } from '@/lib/keys'
import { type Media, type MediaType, originalTitleOf, titleOf, yearOf } from '@/lib/tmdb'

// The 评分来源, in the order the wall shows them: what each is called, and for those MDBList aggregates, its name for
// the source there and, where it scores only some 作品, which (`only`). TMDB's own score comes with the 作品, and
// Douban's is looked up below. A source added here needs its icon in Ratings.tsx, which the compiler asks for.
export const ratingSources = {
  tmdb: { label: ['TMDB', 'TMDB'] },
  imdb: { label: ['IMDb', 'IMDb'], mdblist: 'imdb' },
  tomatoes: { label: ['烂番茄', 'Rotten Tomatoes'], mdblist: 'tomatoes' },
  douban: { label: ['豆瓣', 'Douban'] },
  // Japanese anime only
  mal: { label: ['MyAnimeList', 'MyAnimeList'], mdblist: 'myanimelist', only: (m: Media) => m.original_language === 'ja' },
} satisfies Record<string, { label: Copy; mdblist?: string; only?: (m: Media) => boolean }>

export type Source = keyof typeof ratingSources
export type Ratings = Partial<Record<Source, number>>

// the sources MDBList gives, for the settings page to name
export const fromMdblist = Object.values(ratingSources).filter((s) => 'mdblist' in s)

type MdbList = { ratings: { source: string; value: number | null }[] }
// MDBList's name for each kind of 作品
const mdblistTypes: Record<MediaType, string> = { movie: 'movie', tv: 'show' }

// MDBList's answer for a path, asked with the key in use now; without one, there's none to ask for.
const mdblistGet = (path: string): Promise<MdbList> => {
  const apikey = apiKeyOf('mdblist')
  return apikey
    ? axios.get(`https://api.mdblist.com/${path}`, { params: { apikey } }).then((r) => r.data)
    : Promise.resolve({ ratings: [] })
}
// Whether MDBList takes a key, before it's kept (Settings): none if it does, else why not. Its account's own page,
// which counts against none of the day's requests, and answers a key it doesn't know with a 403 (checked).
export const checkMdblist = (apikey: string) =>
  checked(axios.get('https://api.mdblist.com/user', { params: { apikey } }))

// MDBList's scores for a title, from all its sources at once: one request per title.
export async function mdblist(m: Media, get = mdblistGet): Promise<Ratings> {
  const data = await get(`tmdb/${mdblistTypes[m.media_type]}/${m.id}`)
  const value = (name: string) => data.ratings.find((r) => r.source === name)?.value ?? undefined
  return Object.fromEntries(
    Object.entries(ratingSources).flatMap(([key, s]) =>
      'mdblist' in s && (!('only' in s) || s.only(m)) ? [[key, value(s.mdblist)]] : [],
    ),
  )
}

// ponytail: douban.com sends no CORS headers, so this goes through the Vite dev proxy (/douban, vite.config.ts) and only
// works under the dev server; for the Tauri build switch to @tauri-apps/plugin-http's fetch.
export const hasDouban = import.meta.env.DEV
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

// A title's lookups, one per source, started the first time the title is asked for.
// Douban is searched by the title shown, so a title is looked up again in the other language, and MDBList by the key
// in use, so one put in Settings asks again (none answers with no scores).
function lookups(m: Media) {
  const key = `${m.media_type}/${m.id}/${titleOf(m)}/${apiKeyOf('mdblist') ?? ''}`
  let sources = cache.get(key)
  if (!sources) {
    sources = [mdblist(m), ...(hasDouban ? [douban(m).then((rate) => ({ douban: rate }))] : [])]
    cache.set(key, sources)
  }
  return sources
}

// Each source fills in as soon as it answers, so a slow Douban lookup doesn't hold back the rest. Ratings follow the
// title rather than the object: callers needn't keep `m` stable, and another title starts empty, not with these.
export function useRatings(m: Media) {
  const sources = lookups(m)
  const [state, setState] = useState<{ sources: Promise<Ratings>[]; ratings: Ratings }>()
  useEffect(() => {
    let live = true
    for (const p of sources)
      p.then(
        (r) => live && setState((s) => ({ sources, ratings: { ...(s?.sources === sources ? s.ratings : {}), ...r } })),
        () => {},
      )
    return () => {
      live = false
    }
  }, [sources])
  return state?.sources === sources ? state.ratings : {}
}
