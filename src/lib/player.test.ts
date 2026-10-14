import { expect, test } from 'bun:test'
import { clockOf } from '@/lib/player'

test('a time shows its hours only when it has some, and never runs negative', () => {
  expect(clockOf(0)).toBe('0:00')
  expect(clockOf(59.9)).toBe('0:59')
  expect(clockOf(123)).toBe('2:03')
  expect(clockOf(3723)).toBe('1:02:03')
  expect(clockOf(36000)).toBe('10:00:00')
  expect(clockOf(-5)).toBe('0:00')
})
