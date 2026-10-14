import { expect, test } from 'bun:test'
import { clockOf, speakerOf } from '@/lib/player'

test('a time shows its hours only when it has some, and never runs negative', () => {
  expect(clockOf(0)).toBe('0:00')
  expect(clockOf(59.9)).toBe('0:59')
  expect(clockOf(123)).toBe('2:03')
  expect(clockOf(3723)).toBe('1:02:03')
  expect(clockOf(36000)).toBe('10:00:00')
  expect(clockOf(-5)).toBe('0:00')
})

test("the speaker's waves follow the volume in thirds, crossed out when muted whatever it is", () => {
  const at = (volume: number, muted = false) => speakerOf({ volume, muted })
  expect(at(0)).toBe('speaker.fill')
  expect(at(0.4)).toBe('speaker.fill')
  expect(at(1)).toBe('speaker.wave.1.fill')
  expect(at(33.4)).toBe('speaker.wave.1.fill')
  expect(at(33.6)).toBe('speaker.wave.2.fill')
  expect(at(66)).toBe('speaker.wave.2.fill')
  expect(at(67)).toBe('speaker.wave.3.fill')
  expect(at(100)).toBe('speaker.wave.3.fill')
  expect(at(0, true)).toBe('speaker.slash.fill')
  expect(at(80, true)).toBe('speaker.slash.fill')
})
