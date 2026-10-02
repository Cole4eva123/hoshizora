import { expect, test } from 'bun:test'
import { douban } from './ratings'
import type { Media } from './tmdb'

// Fake Douban: only the original title is known, two entries share the name, the rating comes from subject_abstract.
const fake = (rate: string) => {
  const calls: string[] = []
  const get = async (path: string, params: Record<string, string>) => {
    calls.push(`${path} ${params.q ?? params.subject_id}`)
    if (path === 'subject_abstract') return { subject: { rate } }
    return params.q === 'East of Eden' ? [{ id: '1', year: '1955' }, { id: '35936742', year: '2026' }] : []
  }
  return { calls, get: get as Parameters<typeof douban>[1] }
}

test('douban falls back to the original title and matches on year', async () => {
  const m = { id: 1, name: '伊甸之东', original_name: 'East of Eden', first_air_date: '2026-09-25' } as Media
  const { calls, get } = fake('7.8')
  expect(await douban(m, get)).toBe(7.8)
  expect(calls).toEqual(['subject_suggest 伊甸之东', 'subject_suggest East of Eden', 'subject_abstract 35936742'])
  // a title with too few votes has no score yet
  expect(await douban(m, fake('').get)).toBeUndefined()
})
