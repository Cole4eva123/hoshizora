import axios from 'axios'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

const token: string | undefined = import.meta.env.VITE_TMDB_TOKEN
export const hasToken = Boolean(token)

const api = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  headers: { Authorization: `Bearer ${token}` },
  params: { language: 'zh-CN' },
})

export type MediaType = 'movie' | 'tv'

// A 作品 as the hooks below hand it out: it always knows its own type.
export type Media = {
  id: number
  media_type: MediaType
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

// The 分类: each is a home row (the first page of its request, 20 titles) and a /category page that pages on.
// `votes` is how many ratings a title needs to rank under 高分; without a floor, 10/10 from a single vote tops every
// list. Set per 分类 since TMDB's audience is uneven: in Oct 2026 a floor of 200 left 国产剧 5 titles and 美剧 904.
// Only /discover lists can be sorted, so the trending row has none.
export const categories: Category[] = [
  { key: 'movie', title: '热门电影', path: '/trending/movie/week' },
  { key: 'kdrama', title: '韩剧', path: '/discover/tv?with_original_language=ko&with_genres=18&without_genres=16', votes: 100 },
  { key: 'us', title: '美剧', path: '/discover/tv?with_origin_country=US&with_genres=18&without_genres=16', votes: 200 },
  { key: 'cdrama', title: '国产剧', path: '/discover/tv?with_origin_country=CN&with_genres=18&without_genres=16', votes: 50 },
  { key: 'jdrama', title: '日剧', path: '/discover/tv?with_original_language=ja&with_genres=18&without_genres=16', votes: 50 },
  { key: 'janime', title: '日本动漫', path: '/discover/tv?with_genres=16&with_original_language=ja', votes: 200 },
  { key: 'canime', title: '国漫', path: '/discover/tv?with_genres=16&with_origin_country=CN', votes: 20 },
  { key: 'doc', title: '纪录片', path: '/discover/movie?with_genres=99', votes: 200 },
]

export type Category = { key: string; title: string; path: string; votes?: number }

// Today's trending titles, movies and shows mixed (with people, which useTitles drops).
export const trendingToday = '/trending/all/day'

// TMDB's search over titles of both types and people; useTitles keeps the 作品.
export const searchPath = (query: string) => `/search/multi?query=${encodeURIComponent(query)}`

// A list endpoint's type is in its path: /discover/tv, /trending/tv, …
const typeIn = (path: string): MediaType => (path.includes('/tv') ? 'tv' : 'movie')
const withQuery = (path: string, query: string) => `${path}${path.includes('?') ? '&' : '?'}${query}`

// The orders a 分类 offers. TMDB does the sorting, as the list arrives a page at a time: sorting in the browser
// would only reorder the pages loaded so far. Each `hint` says which titles the order leaves out.
export function sortsOf(c: Category, today = new Date()) {
  if (!c.votes) return []
  const tv = typeIn(c.path) === 'tv'
  const date = tv ? 'first_air_date' : 'primary_release_date'
  const day = today.toLocaleDateString('en-CA') // YYYY-MM-DD in local time
  return [
    { key: 'popular', label: '热门', hint: '最近关注的人最多', path: c.path }, // discover's default order
    {
      key: 'latest',
      label: '最新',
      hint: tv ? '最近开播的在前，还没开播的不算' : '最近上映的在前，还没上映的不算',
      path: withQuery(c.path, `sort_by=${date}.desc&${date}.lte=${day}`),
    },
    {
      key: 'rating',
      label: '高分',
      hint: `只算至少 ${c.votes} 人评过分的作品`,
      path: withQuery(c.path, `sort_by=vote_average.desc&vote_count.gte=${c.votes}`),
    },
    { key: 'votes', label: '口碑', hint: '评过分的人越多越靠前', path: withQuery(c.path, 'sort_by=vote_count.desc') },
  ]
}

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
  // a cast member's id is the person's, for their page
  credits: { cast: { id: number; credit_id: string; name: string; character: string; profile_path: string | null }[] }
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

// Some 片名艺术字 is drawn dark for light posters and vanishes on the dark wall. Takes RGBA pixels; true when the
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
const dayOf = (date: string) => new Date(`${date}T00:00`)
export const daysUntil = (date: string, now = new Date()) =>
  Math.round((dayOf(date).getTime() - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
const airDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
export const airDateOf = (date: string) => airDate.format(dayOf(date)) // "2026年10月8日周四"
export const relativeDays = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
const fullDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' })
// release or first air date in full, "2026年9月28日"
export const releaseOf = (m: Media) => {
  const date = m.release_date || m.first_air_date
  return date ? fullDate.format(dayOf(date)) : ''
}

// When the next episode comes out, or why there isn't one.
export function nextEpisodeText(tv: Details, now = new Date()) {
  const seasons = tv.number_of_seasons ?? 1
  const next = tv.next_episode_to_air
  if (next) {
    const ep = seasons > 1 ? `第 ${next.season_number} 季第 ${next.episode_number} 集` : `第 ${next.episode_number} 集`
    if (!next.air_date) return `下一集：${ep}，播出时间还没公布`
    return `下一集：${ep}，${airDateOf(next.air_date)}播出（${relativeDays.format(daysUntil(next.air_date, now), 'day')}）`
  }
  const done = ({ Ended: '已完结', Canceled: '已停播' } as Record<string, string>)[tv.status]
  if (!done) return '下一集的播出时间还没公布'
  return `${done}，共 ${seasons > 1 ? `${seasons} 季 ` : ''}${tv.number_of_episodes} 集`
}

// A person as /person/{id} describes them: names and biography in Chinese when TMDB has them, the birthplace as TMDB
// records it, usually in English.
export type Person = {
  id: number
  name: string
  also_known_as: string[]
  biography: string
  birthday: string | null
  deathday: string | null
  place_of_birth: string | null
  profile_path: string | null
}

// One of a person's acting credits: a 作品, which carries its own type here, and the part they played.
export type Credit = Media & { character: string; vote_count: number }

// One entry per key, its parts joined. TMDB lists a person in a cast, and a 作品 in a person's credits, once per part
// played, and a part can come blank or twice.
const joinParts = <T extends { character: string }>(list: T[], key: (x: T) => string) => {
  const once = new Map<string, T>()
  for (const x of list) {
    const seen = once.get(key(x))
    const parts = [...(seen ? seen.character.split(' / ') : []), x.character].filter(Boolean)
    once.set(key(x), { ...(seen ?? x), character: [...new Set(parts)].join(' / ') })
  }
  return [...once.values()]
}

// A part that is the person themselves (Self, Self - Guest, Himself…, also after a slash): not a part.
const asThemselves = /(^|\/\s*)(self|himself|herself|themselves)\b/i

// The 作品 a person acted in, each once, best known (most rated) first. Talk shows, making-ofs and award nights, where
// they appear as themselves, under that name or their own, are left out.
export function worksOf(person: Pick<Person, 'name' | 'also_known_as'>, cast: Credit[]) {
  const names = new Set([person.name, ...person.also_known_as])
  const parts = cast.filter((c) => !asThemselves.test(c.character) && !names.has(c.character))
  return joinParts(parts, (c) => c.media_type + c.id).sort((a, b) => b.vote_count - a.vote_count)
}

// Whole years from a birthday to a day; the birthday itself counts.
const yearsTo = (birthday: string, day: Date) => {
  const born = dayOf(birthday)
  const birthdayThatYear = new Date(day.getFullYear(), born.getMonth(), born.getDate())
  return day.getFullYear() - born.getFullYear() - (day < birthdayThatYear ? 1 : 0)
}

// What a person's page says under their name: born, died, age, birthplace; what TMDB doesn't know is left out.
export function lifeOf(p: Person, now = new Date()) {
  const date = (day: string) => fullDate.format(dayOf(day))
  const age = p.birthday ? yearsTo(p.birthday, p.deathday ? dayOf(p.deathday) : now) : undefined
  return [
    p.birthday && `${date(p.birthday)}生`,
    p.deathday && `${date(p.deathday)}逝世`,
    age !== undefined && (p.deathday ? `享年 ${age} 岁` : `${age} 岁`),
    p.place_of_birth,
  ].filter((fact): fact is string => !!fact)
}

const errorText = (e: unknown) => {
  if (!axios.isAxiosError(e)) return e instanceof Error ? e.message : String(e)
  if (e.response?.status === 401) return 'TMDB 令牌无效，检查 VITE_TMDB_TOKEN'
  return e.response ? `TMDB 返回错误 ${e.response.status}` : '连不上 TMDB，检查一下网络'
}

// ponytail: cached for the whole session, add a TTL if long sessions show stale rows; answers would then change,
// which useTmdbAll's memo assumes they don't
const cache = new Map<string, Promise<void>>()
// What the settled requests answered; an answer never changes once in. Hooks read it during render, so a page that
// mounts again (back from a title) is drawn full height in its first frame, when the router restores its scroll.
const answers = new Map<string, unknown>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getTmdb(path: string) {
  let p = cache.get(path)
  if (!p) {
    p = token
      ? api.get(path).then((r) => {
          answers.set(path, r.data)
          listeners.forEach((l) => l())
        })
      : Promise.reject(new Error('还没有配置 TMDB 令牌'))
    p.catch(() => cache.delete(path)) // failed requests are asked again on retry or the next mount
    cache.set(path, p)
  }
  return p
}

// The answers to several requests, in order, each undefined until it arrives, and never another request's answer.
// The missing ones are asked for; `retry` asks again for the ones that failed.
function useTmdbAll<T>(paths: string[]) {
  const key = paths.join('\n')
  // which of these answers are in, like '1101'; it changes, and so re-renders, when one comes in
  const settled = useSyncExternalStore(subscribe, () => paths.map((p) => (answers.has(p) ? 1 : 0)).join(''))
  const data = useMemo(
    () => key.split('\n').map((p, i) => (settled[i] === '1' ? (answers.get(p) as T) : undefined)),
    [key, settled],
  )
  const [failed, setFailed] = useState<{ key: string; error: string }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    for (const p of key.split('\n')) getTmdb(p).catch((e) => live && setFailed({ key, error: errorText(e) }))
    return () => {
      live = false
      setFailed(undefined) // an error goes with its request: other requests, and a retry, start clean
    }
  }, [key, attempt])
  const retry = () => setAttempt((n) => n + 1)
  return { data, error: failed?.key === key ? failed.error : undefined, retry }
}

function useTmdb<T>(path: string) {
  const { data, error } = useTmdbAll<T>([path])
  return { data: data[0], error }
}

// A list result as TMDB sends it: /discover and /trending/{movie,tv} leave out media_type, /trending/all mixes in people.
type Listed = Omit<Media, 'media_type'> & { media_type?: MediaType | 'person' }
type ListPage = { total_pages: number; results: Listed[] }

// The 作品 in a list, each with its type: its own when TMDB sends one, else the one in the endpoint path. Pages are
// numbered by offset and popularity shifts between requests, so a title can come back on the next page: kept once.
export const toTitles = (path: string, results: Listed[]): Media[] => {
  const seen = new Set<string>()
  return results.flatMap((m) => {
    const media_type = m.media_type ?? typeIn(path)
    if (media_type === 'person' || seen.has(media_type + m.id)) return []
    seen.add(media_type + m.id)
    return [{ ...m, media_type }]
  })
}

// TMDB serves at most 500 pages of any list.
const maxPages = 500

// The first `pages` (≥ 1) pages of a list as one list of 作品. `loading` while pages are on their way, `more` when TMDB has
// pages after them, `retry` asks again for the ones that failed.
export function useTitles(path: string, pages = 1) {
  pages = Math.min(Math.max(1, Math.floor(pages)) || 1, maxPages)
  const paths = Array.from({ length: pages }, (_, i) => withQuery(path, `page=${i + 1}`))
  const { data, error, retry } = useTmdbAll<ListPage>(paths)
  // The pages in so far, from the first: their titles stay on screen while the next page loads.
  const arrived = useMemo(() => {
    const gap = data.indexOf(undefined)
    return (gap < 0 ? data : data.slice(0, gap)) as ListPage[]
  }, [data])
  const titles = useMemo(
    () => (arrived.length ? toTitles(path, arrived.flatMap((p) => p.results)) : undefined),
    [arrived, path],
  )
  const more = !!arrived.length && pages < Math.min(arrived[0].total_pages, maxPages)
  return { titles, loading: arrived.length < pages, more, error, retry }
}

// include_image_language=null keeps only textless backdrops, which suit the wall. For shows, credits is the current
// cast; aggregate_credits covers every season but runs to megabytes for long-running ones.
// `backdrops` are the 剧照 for the wall: textless ones, else the main backdrop, which may carry text.
export function useDetails(type: MediaType, id: string) {
  const { data, error } = useTmdb<Omit<Details, 'media_type'>>(
    `/${type}/${id}?append_to_response=images,credits&include_image_language=null`,
  )
  const backdrops = data ? data.images.backdrops.slice(0, 8).map((b) => b.file_path) : []
  if (!backdrops.length && data?.backdrop_path) backdrops.push(data.backdrop_path)
  // details leave out media_type; someone in two parts gets one place in the cast, so one headshot opens their page
  const details = useMemo(
    () => data && { ...data, media_type: type, credits: { cast: joinParts(data.credits.cast, (p) => `${p.id}`) } },
    [data, type],
  )
  return { details, backdrops, error }
}

// A season's episodes. TMDB names an untranslated episode "第 N 集"; that name is dropped, as the number shows anyway.
export function useSeason(tvId: number, season: number) {
  const { data, error } = useTmdb<{ episodes: Episode[] }>(`/tv/${tvId}/season/${season}`)
  const episodes = useMemo(
    () => data?.episodes.map((e) => (e.name === `第 ${e.episode_number} 集` ? { ...e, name: '' } : e)),
    [data],
  )
  return { episodes, error }
}

// A person with the 作品 they acted in, movies and shows: one request.
const personPath = (id: number | string) => `/person/${id}?append_to_response=combined_credits`

export function usePerson(id: string) {
  const { data, error } = useTmdb<Person & { combined_credits: { cast: Credit[] } }>(personPath(id))
  // TMDB biographies indent their paragraphs with ideographic spaces and space them with blank lines; neither is
  // kept, so a folded biography shows five lines of text
  const person = useMemo(() => data && { ...data, biography: data.biography.replace(/^\s+/gm, '').trim() }, [data])
  const works = useMemo(() => data && worksOf(data, data.combined_credits.cast), [data])
  return { person, works, error }
}

// Asks for a person ahead of a click (the pointer is on their headshot), so their page is complete in its first frame
// and the headshot can grow into its portrait.
export const prefetchPerson = (id: number) => {
  getTmdb(personPath(id)) // a failure is dropped from the cache; the page asks again
}
