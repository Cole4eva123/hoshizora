import axios from 'axios'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { type Copy, type Translate, useT } from '@/lib/i18n'

const token: string | undefined = import.meta.env.VITE_TMDB_TOKEN
export const hasToken = Boolean(token)

const api = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  headers: { Authorization: `Bearer ${token}` },
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
  { key: 'movie', title: ['热门电影', 'Trending Movies'], path: '/trending/movie/week' },
  { key: 'kdrama', title: ['韩剧', 'K-Dramas'], path: '/discover/tv?with_original_language=ko&with_genres=18&without_genres=16', votes: 100 },
  { key: 'us', title: ['美剧', 'US Dramas'], path: '/discover/tv?with_origin_country=US&with_genres=18&without_genres=16', votes: 200 },
  { key: 'cdrama', title: ['国产剧', 'C-Dramas'], path: '/discover/tv?with_origin_country=CN&with_genres=18&without_genres=16', votes: 50 },
  { key: 'jdrama', title: ['日剧', 'J-Dramas'], path: '/discover/tv?with_original_language=ja&with_genres=18&without_genres=16', votes: 50 },
  { key: 'janime', title: ['日本动漫', 'Anime'], path: '/discover/tv?with_genres=16&with_original_language=ja', votes: 200 },
  { key: 'canime', title: ['国漫', 'Chinese Animation'], path: '/discover/tv?with_genres=16&with_origin_country=CN', votes: 20 },
  { key: 'doc', title: ['纪录片', 'Documentaries'], path: '/discover/movie?with_genres=99', votes: 200 },
]

export type Category = { key: string; title: Copy; path: string; votes?: number }

// Today's trending titles, movies and shows mixed (with people, which useTitles drops).
export const trendingToday = '/trending/all/day'

// TMDB's search over titles of both types and people; useTitles keeps the 作品.
export const searchPath = (query: string) => `/search/multi?query=${encodeURIComponent(query)}`

// A list endpoint's type is in its path: /discover/tv, /trending/tv, …
const typeIn = (path: string): MediaType => (path.includes('/tv') ? 'tv' : 'movie')
const withQuery = (path: string, query: string) => `${path}${path.includes('?') ? '&' : '?'}${query}`

// The orders a 分类 offers. TMDB does the sorting, as the list arrives a page at a time: sorting in the browser
// would only reorder the pages loaded so far. Each `hint` says which titles the order leaves out.
export function sortsOf(c: Category, t: Translate, today = new Date()) {
  if (!c.votes) return []
  const tv = typeIn(c.path) === 'tv'
  const date = tv ? 'first_air_date' : 'primary_release_date'
  const day = today.toLocaleDateString('en-CA') // YYYY-MM-DD in local time
  return [
    // discover's default order
    { key: 'popular', label: t('热门', 'Popular'), hint: t('最近关注的人最多', 'Getting the most attention lately'), path: c.path },
    {
      key: 'latest',
      label: t('最新', 'Latest'),
      hint: tv
        ? t('最近开播的在前，还没开播的不算', 'Latest premieres first, not counting upcoming ones')
        : t('最近上映的在前，还没上映的不算', 'Latest releases first, not counting upcoming ones'),
      path: withQuery(c.path, `sort_by=${date}.desc&${date}.lte=${day}`),
    },
    {
      key: 'rating',
      label: t('高分', 'Top Rated'),
      hint: t(`只算至少 ${c.votes} 人评过分的作品`, `Only titles rated by at least ${c.votes} people`),
      path: withQuery(c.path, `sort_by=vote_average.desc&vote_count.gte=${c.votes}`),
    },
    {
      key: 'votes',
      label: t('口碑', 'Most Rated'),
      hint: t('评过分的人越多越靠前', 'The more people rated it, the higher it ranks'),
      path: withQuery(c.path, 'sort_by=vote_count.desc'),
    },
  ]
}

type Genre = { id: number; name: string }
// TMDB's Chinese list leaves these two in English
const zhNames: Record<number, string> = { 10765: '科幻奇幻', 10768: '战争政治' }

// The 类型 a 分类 can be narrowed by, from its type's list on TMDB: all of them, less those its own request names (剧情
// for a drama, 动画 kept out of one), in the language's order (pinyin in Chinese), as TMDB's follows the English names.
export function genresOf(c: Category, genres: Genre[], t: Translate) {
  const own = new URLSearchParams(c.path.split('?')[1])
  const named = [own.get('with_genres'), own.get('without_genres')].join(',').split(',').map(Number)
  const order = new Intl.Collator(locale(t))
  return genres
    .filter((g) => !named.includes(g.id))
    .map((g) => ({ key: g.id, label: t(zhNames[g.id] ?? g.name, g.name) }))
    .toSorted((a, b) => order.compare(a.label, b.label))
}

// A 分类's 类型, for its sorts' row: none for one without sorts, and none until TMDB's list is in. Asked of TMDB rather
// than written out, so a 类型 TMDB adds shows up by itself.
export function useGenres(c: Category | undefined) {
  const t = useT()
  const { data } = useTmdbAll<{ genres: Genre[] }>(c?.votes ? [`/genre/${typeIn(c.path)}/list`] : [])
  return c && data[0] ? genresOf(c, data[0].genres, t) : []
}

// Picked 类型 narrow a list to the 作品 that have every one (TMDB's comma means and). They join the 分类's own
// with_genres, as TMDB fails a request that names it twice, in one order whichever was picked first, so a set of 类型
// is one request in the cache. None picked, no change: the 分类 page shares its home row's request.
export function withGenres(path: string, ids: number[]) {
  if (!ids.length) return path
  const [base, query] = path.split('?')
  const params = new URLSearchParams(query)
  params.set('with_genres', [params.get('with_genres'), ...ids.toSorted((a, b) => a - b)].filter(Boolean).join(','))
  return `${base}?${params}`
}

export const titleOf = (m: Media) => m.title ?? m.name ?? ''
// The 作品 of the list a card was opened from, in the order shown, so the title page can step to the ones before and
// after. It rides along in the history entry, so it keeps only what that needs.
export type Lineup = { media_type: MediaType; id: number; title: string }[]
// a 作品's own page
export const hrefOf = (m: Pick<Media, 'media_type' | 'id'>) => `/${m.media_type}/${m.id}`
export const lineupOf = (list: Media[]): Lineup =>
  list.map((m) => ({ media_type: m.media_type, id: m.id, title: titleOf(m) }))
// Where a title page was opened from: the lineup, and for a list that pages on (a 分类, a search) its request and the
// pages it showed, so stepping past the last one goes on into the next page.
export type From = { lineup: Lineup; list?: { path: string; pages: number } }
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

// A title's own lettering: in the language shown first (Simplified Chinese, or English), then the original language,
// then English, then any.
export function pickLogo(logos: Logo[], t: Translate, originalLanguage?: string) {
  const find = (lang?: string, region?: string) =>
    logos.find((l) => l.iso_639_1 === lang && (!region || l.iso_3166_1 === region))
  return t(find('zh', 'CN'), find('en')) ?? find(originalLanguage) ?? find('en') ?? logos[0]
}

export function useLogo(m: Media) {
  const t = useT()
  const { data, error } = useTmdb<{ logos: Logo[] }>(
    `/${m.media_type}/${m.id}/images?include_image_language=zh,${m.original_language},en,null`,
  )
  return { ready: Boolean(data || error), logo: data && pickLogo(data.logos, t, m.original_language) }
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
// TMDB's language and the dates' locale
const locale = (t: Translate) => t('zh-CN', 'en-US')
// "2026年10月8日周四", "Thu, October 8, 2026"
export const airDateOf = (date: string, t: Translate) =>
  dayOf(date).toLocaleDateString(locale(t), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
// "6天后", "in 6 days"
export const relativeDays = (days: number, t: Translate) =>
  new Intl.RelativeTimeFormat(locale(t), { numeric: 'auto' }).format(days, 'day')
// "2026年9月28日", "September 28, 2026"
const fullDate = (date: string, t: Translate) => dayOf(date).toLocaleDateString(locale(t), { dateStyle: 'long' })
// release or first air date in full
export const releaseOf = (m: Media, t: Translate) => {
  const date = m.release_date || m.first_air_date
  return date ? fullDate(date, t) : ''
}

// When the next episode comes out, or why there isn't one.
export function nextEpisodeText(tv: Details, t: Translate, now = new Date()) {
  const seasons = tv.number_of_seasons ?? 1
  const next = tv.next_episode_to_air
  if (next) {
    const ep =
      seasons > 1
        ? t(`第 ${next.season_number} 季第 ${next.episode_number} 集`, `S${next.season_number} E${next.episode_number}`)
        : t(`第 ${next.episode_number} 集`, `Episode ${next.episode_number}`)
    if (!next.air_date) return t(`下一集：${ep}，播出时间还没公布`, `Next: ${ep}, air date not announced yet`)
    const date = airDateOf(next.air_date, t)
    const days = relativeDays(daysUntil(next.air_date, now), t)
    return t(`下一集：${ep}，${date}播出（${days}）`, `Next: ${ep} on ${date} (${days})`)
  }
  const done = ({ Ended: t('已完结', 'Ended'), Canceled: t('已停播', 'Canceled') } as Record<string, string>)[tv.status]
  if (!done) return t('下一集的播出时间还没公布', 'Next episode not announced yet')
  const episodes = tv.number_of_episodes
  return t(
    `${done}，共 ${seasons > 1 ? `${seasons} 季 ` : ''}${episodes} 集`,
    `${done} after ${seasons > 1 ? `${seasons} seasons and ` : ''}${episodes} episode${episodes === 1 ? '' : 's'}`,
  )
}

// A person as /person/{id} describes them: names and biography in the language shown when TMDB has them, the
// birthplace as TMDB records it, usually in English.
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
export function lifeOf(p: Person, t: Translate, now = new Date()) {
  const date = (day: string) => fullDate(day, t)
  const age = p.birthday ? yearsTo(p.birthday, p.deathday ? dayOf(p.deathday) : now) : undefined
  return [
    p.birthday && t(`${date(p.birthday)}生`, `Born ${date(p.birthday)}`),
    p.deathday && t(`${date(p.deathday)}逝世`, `Died ${date(p.deathday)}`),
    age !== undefined &&
      (p.deathday ? t(`享年 ${age} 岁`, `Aged ${age}`) : t(`${age} 岁`, `${age} year${age === 1 ? '' : 's'} old`)),
    p.place_of_birth,
  ].filter((fact): fact is string => !!fact)
}

const errorText = (e: unknown, t: Translate) => {
  if (!token) return t('还没有配置 TMDB 令牌', 'No TMDB token set up yet')
  if (!axios.isAxiosError(e)) return e instanceof Error ? e.message : String(e)
  if (e.response?.status === 401) return t('TMDB 令牌无效，检查 VITE_TMDB_TOKEN', 'TMDB rejected the token, check VITE_TMDB_TOKEN')
  return e.response
    ? t(`TMDB 返回错误 ${e.response.status}`, `TMDB answered with error ${e.response.status}`)
    : t('连不上 TMDB，检查一下网络', "Can't reach TMDB, check your connection")
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

// Each request asks for the language shown, so the two languages' answers are cached apart.
// ponytail: a switch asks again for everything on screen, and pages show their loading state until it's in: Detail and
// Person drop to their back button, losing the scroll and the picked season, and pages back in history, cached in the
// other language only, lose their scroll. Let the other language's answer stand in while the new one loads if
// switching mid-page ever matters.
const inLanguage = (path: string, t: Translate) => withQuery(path, `language=${locale(t)}`)

// The requests a key stands for; none for the empty key of a hook asked for nothing.
const localizedOf = (key: string) => (key ? key.split('\n') : [])

// The answers to several requests, in order, each undefined until it arrives, and never another request's answer.
// The missing ones are asked for; `retry` asks again for the ones that failed.
function useTmdbAll<T>(paths: string[]) {
  const t = useT()
  const localized = paths.map((p) => inLanguage(p, t))
  const key = localized.join('\n')
  // which of these answers are in, like '1101'; it changes, and so re-renders, when one comes in
  const settled = useSyncExternalStore(subscribe, () => localized.map((p) => (answers.has(p) ? 1 : 0)).join(''))
  const data = useMemo(
    () => localizedOf(key).map((p, i) => (settled[i] === '1' ? (answers.get(p) as T) : undefined)),
    [key, settled],
  )
  const [failed, setFailed] = useState<{ key: string; error: string }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    for (const p of localizedOf(key)) getTmdb(p).catch((e) => live && setFailed({ key, error: errorText(e, t) }))
    return () => {
      live = false
      setFailed(undefined) // an error goes with its request: other requests, and a retry, start clean
    }
  }, [key, attempt, t])
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
// pages after them, `retry` asks again for the ones that failed. Without a `path` it asks for nothing.
export function useTitles(path: string | undefined, pages = 1) {
  pages = Math.min(Math.max(1, Math.floor(pages)) || 1, maxPages)
  const paths = path ? Array.from({ length: pages }, (_, i) => withQuery(path, `page=${i + 1}`)) : []
  const { data, error, retry } = useTmdbAll<ListPage>(paths)
  // The pages in so far, from the first: their titles stay on screen while the next page loads.
  const arrived = useMemo(() => {
    const gap = data.indexOf(undefined)
    return (gap < 0 ? data : data.slice(0, gap)) as ListPage[]
  }, [data])
  const titles = useMemo(
    () => (path && arrived.length ? toTitles(path, arrived.flatMap((p) => p.results)) : undefined),
    [arrived, path],
  )
  const more = !!arrived.length && pages < Math.min(arrived[0].total_pages, maxPages)
  return { titles, loading: arrived.length < paths.length, more, error, retry }
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

// A season's episodes. TMDB names an untranslated episode "第 N 集" ("Episode N"); that name is dropped, as the number
// shows anyway.
export function useSeason(tvId: number, season: number) {
  const t = useT()
  const { data, error } = useTmdb<{ episodes: Episode[] }>(`/tv/${tvId}/season/${season}`)
  const episodes = useMemo(
    () =>
      data?.episodes.map((e) =>
        e.name === t(`第 ${e.episode_number} 集`, `Episode ${e.episode_number}`) ? { ...e, name: '' } : e,
      ),
    [data, t],
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
export const prefetchPerson = (id: number, t: Translate) => {
  getTmdb(inLanguage(personPath(id), t)) // a failure is dropped from the cache; the page asks again
}
