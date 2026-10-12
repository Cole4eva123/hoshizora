import { expect, test } from 'bun:test'
import { addFolder, getFavorites, isWatched, parse, removeFolder, toggleIn, toggleWatched } from '@/lib/favorites'
import type { Media } from '@/lib/tmdb'

// a 作品 as the title page has it, with more than a card keeps
const dune = { id: 438631, media_type: 'movie', title: '沙丘', poster_path: '/d.jpg', release_date: '2021-09-15', overview: '…', credits: { cast: [] } } as Media
const shogun = { id: 126308, media_type: 'tv', name: '幕府将军', poster_path: '/s.jpg', first_air_date: '2024-02-27' } as Media
const titlesIn = (id: string) => getFavorites().folders.find((f) => f.id === id)!.titles

test('a 收藏夹 keeps each 作品 once, as a card, the latest saved first', () => {
  const want = addFolder('想看', dune)
  toggleIn(want, shogun)
  expect(titlesIn(want).map((m) => m.id)).toEqual([126308, 438631])
  expect(titlesIn(want)[1]).toEqual({ id: 438631, media_type: 'movie', title: '沙丘', poster_path: '/d.jpg', release_date: '2021-09-15' })
  toggleIn(want, dune)
  expect(titlesIn(want).map((m) => m.id)).toEqual([126308])
  removeFolder(want)
  expect(getFavorites().folders.some((f) => f.id === want)).toBe(false)
})

test('看过 goes with the 作品, whichever 收藏夹 holds it, and outlasts them', () => {
  const a = addFolder('想看', dune)
  addFolder('周末', dune)
  toggleWatched(dune)
  expect(isWatched(getFavorites(), dune)).toBe(true)
  expect(isWatched(getFavorites(), shogun)).toBe(false)
  removeFolder(a)
  expect(isWatched(getFavorites(), dune)).toBe(true)
  toggleWatched(dune)
  expect(isWatched(getFavorites(), dune)).toBe(false)
})

test('kept data missing a part the pages read is read as nothing, not drawn', () => {
  const kept = { folders: [{ id: 'a', name: '想看', titles: [{ id: 1, media_type: 'movie' }] }], watched: ['/movie/1'] }
  expect(parse(JSON.stringify(kept))).toEqual(kept)
  const none = { folders: [], watched: [] }
  expect(parse('{')).toEqual(none)
  expect(parse(JSON.stringify({ folders: [{ id: 'a', name: '想看' }], watched: [] }))).toEqual(none)
  expect(parse(JSON.stringify({ folders: [{ id: 'a', name: '想看', titles: [null] }], watched: [] }))).toEqual(none)
  expect(parse(JSON.stringify({ ...kept, watched: [1] }))).toEqual(none)
})
