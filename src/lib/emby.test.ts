import { expect, test } from 'bun:test'
// Finding a server, signing in and reading its answers are emby-core's, tested in Rust (src-tauri/emby-core).
import { type Answer, type Server, itemsOf, librarySorts, lineupOfItems, pickOf } from '@/lib/emby'
import { zh } from '@/lib/i18n'

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
