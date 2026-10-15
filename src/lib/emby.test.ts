import { expect, test } from 'bun:test'
// Finding a server, signing in and reading its answers are emby-core's, tested in Rust (src-tauri/emby-core).
import {
  type Answer,
  type Resume,
  type Server,
  itemsOf,
  leftOf,
  librarySorts,
  lineupOfItems,
  pickOf,
  resumeTitle,
  resumesOf,
} from '@/lib/emby'
import { en, zh } from '@/lib/i18n'

test('librarySorts turns 最新 into 最早 where it stands, and back', () => {
  const keys = (picked?: string) => librarySorts(zh, picked).map((s) => [s.key, s.flip])
  expect(keys()).toEqual([['added', undefined], ['latest', 'oldest'], ['rating', undefined]])
  expect(keys('oldest')).toEqual([['added', undefined], ['oldest', 'latest'], ['rating', undefined]])
})

test('itemsOf keeps each 作品 once, as one added while the list pages on pushes the last of a page onto the next', () => {
  const item = (id: string) => ({ id, name: id })
  expect(itemsOf([{ items: [item('a'), item('b')] }, { items: [item('b'), item('c')] }])).toEqual([
    item('a'),
    item('b'),
    item('c'),
  ])
})

test('lineupOfItems steps through the 作品 with a TMDB entry, each once however many copies the server keeps', () => {
  const copy = (id: string, tmdb?: number) => ({ id, name: id, tmdb: tmdb ? { media_type: 'movie' as const, id: tmdb } : undefined })
  expect(lineupOfItems([copy('A', 1), copy('X 4K', 2), copy('none'), copy('X', 2), copy('B', 3)])).toEqual([
    { media_type: 'movie', id: 1, title: 'A' },
    { media_type: 'movie', id: 2, title: 'X' },
    { media_type: 'movie', id: 3, title: 'B' },
  ])
})

test('pickOf shows the 片源 wanted, waiting for its server, else the first found that plays', () => {
  const server = (id: string) => ({ id, userId: 'u' }) as Server
  const [a, b] = [server('a'), server('b')]
  const asking = (s: Server): Answer => ({ s })
  const has = (s: Server, ...items: [string, number?][]): Answer => ({
    s,
    sources: items.map(([item, seasons]) => ({ item, name: item, seasons, versions: [] })),
  })
  const down: Answer = { s: a, error: '连接异常' }
  const picked = ({ pick, exact }: ReturnType<typeof pickOf>) => pick && `${pick.s.id}/${pick.src.item}${exact ? '!' : ''}`
  // none wanted: the first found, whichever server answers first
  expect(picked(pickOf([asking(a), has(b, ['b1'])]))).toBe('b/b1')
  expect(picked(pickOf([down, has(b, ['b1'])]))).toBe('b/b1')
  // opened from a's page: wait for a; its copy wanted, or its first; elsewhere when a hasn't the 作品
  const fromA = { server: 'a', user: 'u', item: 'a2' }
  expect(picked(pickOf([asking(a), has(b, ['b1'])], fromA))).toBeUndefined()
  expect(picked(pickOf([has(a, ['a1'], ['a2']), has(b, ['b1'])], fromA))).toBe('a/a2!')
  expect(picked(pickOf([has(a, ['a1']), has(b, ['b1'])], { server: 'a', user: 'u' }))).toBe('a/a1')
  expect(picked(pickOf([has(a), has(b, ['b1'])], fromA))).toBe('b/b1')
  // a series: one with episodes before one without, which is shown once no server is still asked
  expect(picked(pickOf([has(a, ['a0', 0]), has(b, ['b1', 2])]))).toBe('b/b1')
  expect(picked(pickOf([has(a, ['a0', 0]), asking(b)]))).toBeUndefined()
  expect(picked(pickOf([has(a, ['a0', 0]), has(b)]))).toBe('a/a0')
  // the server shown, kept as wanted: still its copy with episodes, though its first has none; and another server's
  // with episodes over the wanted one's without
  expect(picked(pickOf([has(a, ['a0', 0], ['a1', 2])], { server: 'a', user: 'u' }))).toBe('a/a1')
  expect(picked(pickOf([has(a, ['a0', 0]), has(b, ['b1', 2])], { server: 'a', user: 'u' }))).toBe('b/b1')
})

test('resumesOf puts every server\'s 继续观看 in one list, the last played first, one with no date last', () => {
  const [a, b] = [{ id: 'a', userId: 'u' }, { id: 'b', userId: 'u' }] as Server[]
  const r = (item: string, played?: string): Resume => ({ item, name: item, position: 60, played })
  const lists = [
    { s: a, resumes: [r('a1', '2026-10-14T21:00:00.0000000Z'), r('a2', '2026-10-12T08:00:00.0000000Z'), r('a3')] },
    // another Emby's way of writing them
    { s: b, resumes: [r('b1', '2026-10-14T05:00:00+08:00'), r('b2', '2026-10-13T23:59:59Z')] },
    // one still asked, or that couldn't be
    { s: b },
  ]
  expect(resumesOf(lists).map(({ s, r }) => `${s.id}:${r.item}`)).toEqual(['a:a1', 'b:b2', 'b:b1', 'a:a2', 'a:a3'])
})

test('leftOf says what is left of a 继续观看, or where it was left off when its length is unknown', () => {
  expect(leftOf({ position: 1243, runtime: 7507 }, zh)).toBe('还剩 1 小时 44 分钟')
  expect(leftOf({ position: 0, runtime: 3600 }, zh)).toBe('还剩 1 小时')
  expect(leftOf({ position: 2520, runtime: 2700 }, en)).toBe('3 min left')
  // a few seconds from the end still has a minute left, not none
  expect(leftOf({ position: 2695, runtime: 2700 }, zh)).toBe('还剩 1 分钟')
  expect(leftOf({ position: 1243 }, zh)).toBe('看到 20:43')
})

test('resumeTitle names an episode by its series and numbers, as the 作品 page names what it plays', () => {
  const r = (more: Partial<Resume>): Resume => ({ item: 'i', name: '控制', position: 0, ...more })
  expect(resumeTitle(r({ series: '漫长的季节', season: 1, episode: 5 }), zh)).toBe('漫长的季节 · 第 1 季第 5 集')
  expect(resumeTitle(r({ series: 'The Long Season', season: 1, episode: 5 }), en)).toBe('The Long Season · S1 E5')
  expect(resumeTitle(r({ name: '流浪地球' }), zh)).toBe('流浪地球')
})
