import { expect, test } from 'bun:test'
// Finding a server, signing in and reading its answers are emby-core's, tested in Rust (src-tauri/emby-core).
import { itemsOf, lineupOfItems } from '@/lib/emby'

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
