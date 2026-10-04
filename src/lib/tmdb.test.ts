import { expect, test } from 'bun:test'
import { type Category, type Credit, type Details, type Episode, type Logo, type Media, type Person, daysUntil, isDarkInk, lifeOf, nextEpisodeText, pickLogo, releaseOf, sortsOf, toTitles, worksOf } from './tmdb'

const now = new Date('2026-10-02T21:30')
const ep = (season_number: number, episode_number: number, air_date: string | null) =>
  ({ season_number, episode_number, air_date }) as Episode
const show = (fields: Partial<Details>) => ({ status: 'Returning Series', number_of_seasons: 1, ...fields }) as Details

test('next episode: season shown only when there are several, countdown in days', () => {
  // late evening still counts as today, and the DST change on Nov 1 doesn't shift the count
  expect(daysUntil('2026-10-02', now)).toBe(0)
  expect(daysUntil('2026-11-03', now)).toBe(32)

  const svu = show({ number_of_seasons: 28, next_episode_to_air: ep(28, 1, '2026-10-08') })
  expect(nextEpisodeText(svu, now)).toContain('下一集：第 28 季第 1 集，')
  expect(nextEpisodeText(svu, now)).toEndWith('播出（6天后）')
  expect(nextEpisodeText(show({ next_episode_to_air: ep(1, 40, '2026-10-02') }), now)).toEndWith('（今天）')
  expect(nextEpisodeText(show({ next_episode_to_air: ep(1, 9, null) }), now)).toBe('下一集：第 9 集，播出时间还没公布')

  expect(nextEpisodeText(show({ status: 'Ended', number_of_episodes: 8 }), now)).toBe('已完结，共 8 集')
  expect(nextEpisodeText(show({ status: 'Canceled', number_of_seasons: 3, number_of_episodes: 30 }), now)).toBe(
    '已停播，共 3 季 30 集',
  )
  expect(nextEpisodeText(show({}), now)).toBe('下一集的播出时间还没公布')
})

test('logo: Simplified Chinese, then the original language, then English; dark ink is caught', () => {
  const logo = (iso_639_1: string, iso_3166_1: string) => ({ file_path: `/${iso_639_1}-${iso_3166_1}`, iso_639_1, iso_3166_1 }) as Logo
  const pick = (logos: Logo[], lang: string) => pickLogo(logos, lang)?.file_path
  expect(pick([logo('en', 'US'), logo('zh', 'TW'), logo('zh', 'CN')], 'en')).toBe('/zh-CN')
  expect(pick([logo('zh', 'TW'), logo('en', 'US'), logo('ja', 'JP')], 'ja')).toBe('/ja-JP')
  expect(pick([logo('zh', 'TW'), logo('en', 'US')], 'es')).toBe('/en-US')
  expect(pick([logo('zh', 'TW')], 'ar')).toBe('/zh-TW')
  expect(pick([], 'en')).toBeUndefined()

  const ink = (...rgba: number[]) => new Uint8ClampedArray(rgba)
  expect(isDarkInk(ink(0, 0, 0, 255, 255, 255, 255, 0))).toBe(true) // black ink; the transparent white pixel doesn't count
  // measured averages of real logos: 我宁愿死 near-black red, 生化危机 blood red at about 2:1
  expect(isDarkInk(ink(51, 8, 6, 255))).toBe(true)
  expect(isDarkInk(ink(147, 10, 11, 255))).toBe(false)
  expect(isDarkInk(ink(255, 255, 255, 255))).toBe(false)
  expect(isDarkInk(ink(0, 0, 0, 0))).toBe(false) // nothing opaque
})

test('release date in full', () => {
  expect(releaseOf({ media_type: 'movie', release_date: '2026-09-28' } as Media)).toBe('2026年9月28日')
  expect(releaseOf({ media_type: 'tv', first_air_date: '2025-03-27' } as Media)).toBe('2025年3月27日')
  expect(releaseOf({ media_type: 'movie', release_date: '' } as Media)).toBe('') // not dated yet
})

test('lists hand out 作品 that know their type, once each, and no people', () => {
  const listed = (id: number, media_type?: 'movie' | 'tv' | 'person') => ({ id, media_type }) as Parameters<typeof toTitles>[1][number]
  const types = (path: string, ...results: ReturnType<typeof listed>[]) => toTitles(path, results).map((m) => `${m.id} ${m.media_type}`)
  expect(types('/discover/tv?with_genres=16', listed(1))).toEqual(['1 tv'])
  expect(types('/discover/movie?with_genres=99', listed(1))).toEqual(['1 movie'])
  expect(types('/trending/all/day', listed(1, 'tv'), listed(2, 'person'), listed(3, 'movie'))).toEqual(['1 tv', '3 movie'])
  // a title that slid onto the next page shows once; a show and a movie may share an id
  expect(types('/trending/all/day', listed(1, 'tv'), listed(1, 'movie'), listed(1, 'tv'))).toEqual(['1 tv', '1 movie'])
})

test('sorting: TMDB sorts, 最新 skips the unreleased, 高分 needs the 分类 vote floor, trending has none', () => {
  const day = new Date('2026-10-02T23:30') // late evening is still the 2nd locally
  const paths = (c: Category) => Object.fromEntries(sortsOf(c, day).map((s) => [s.key, s.path]))
  const show = { key: 'k', title: '韩剧', path: '/discover/tv?with_genres=18', votes: 100 }
  expect(paths(show)).toEqual({
    popular: '/discover/tv?with_genres=18', // the home row's request, so the two share a cache
    latest: '/discover/tv?with_genres=18&sort_by=first_air_date.desc&first_air_date.lte=2026-10-02',
    rating: '/discover/tv?with_genres=18&sort_by=vote_average.desc&vote_count.gte=100',
    votes: '/discover/tv?with_genres=18&sort_by=vote_count.desc',
  })
  expect(paths({ ...show, path: '/discover/movie?with_genres=99' }).latest).toContain('primary_release_date.lte=2026-10-02')
  expect(sortsOf({ key: 'm', title: '热门电影', path: '/trending/movie/week' })).toEqual([])
})

test("an actor's 作品: parts only, each 作品 once with its parts joined, the best known first", () => {
  const credit = (media_type: 'movie' | 'tv', id: number, character: string, vote_count: number) =>
    ({ media_type, id, character, vote_count }) as Credit
  const works = worksOf({ name: '胡歌', also_known_as: ['Hu Ge'] }, [
    credit('movie', 1, 'Zhou Zenong', 384),
    credit('tv', 2, 'Self - Guest', 900), // a talk show
    credit('tv', 3, 'Mei Changsu', 77),
    credit('tv', 3, 'Lin Shu', 77), // the same show, a second part
    credit('movie', 3, 'Narrator', 10), // a movie with the show's id is another 作品
    credit('movie', 4, 'Herself (archive footage)', 50),
    credit('tv', 5, '胡歌', 40), // playing himself, by name
    credit('movie', 6, 'Beskod (voice)', 66),
    credit('tv', 7, '', 5), // listed twice, the first part blank
    credit('tv', 7, 'Tian Han', 5),
    credit('tv', 3, 'Mei Changsu', 77), // a part listed again
    credit('movie', 8, 'Future Self', 3), // a part, though it says Self
    credit('tv', 9, 'Themselves', 30), // a band as itself
    credit('movie', 10, 'Narrator / Self', 20),
  ])
  expect(works.map((w) => `${w.media_type}${w.id} ${w.character}`)).toEqual([
    'movie1 Zhou Zenong',
    'tv3 Mei Changsu / Lin Shu',
    'movie6 Beskod (voice)',
    'movie3 Narrator',
    'tv7 Tian Han',
    'movie8 Future Self',
  ])
})

test('a person: born, age, birthplace; or died and the age reached', () => {
  const p = (fields: Partial<Person>) => ({ birthday: null, deathday: null, place_of_birth: null, ...fields }) as Person
  expect(lifeOf(p({ birthday: '1963-12-18', place_of_birth: 'Shawnee, Oklahoma, USA' }), now)).toEqual([
    '1963年12月18日生',
    '62 岁',
    'Shawnee, Oklahoma, USA',
  ])
  expect(lifeOf(p({ birthday: '1972-10-02' }), now)[1]).toBe('54 岁') // a birthday today counts
  expect(lifeOf(p({ birthday: '1940-10-03' }), now)[1]).toBe('85 岁') // tomorrow's doesn't yet
  expect(lifeOf(p({ birthday: '1925-01-26', deathday: '2008-09-26' }), now)).toEqual([
    '1925年1月26日生',
    '2008年9月26日逝世',
    '享年 83 岁',
  ])
  expect(lifeOf(p({}), now)).toEqual([])
})
