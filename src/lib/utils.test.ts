import { expect, test } from 'bun:test'
import { mostCols } from '@/lib/utils'

test('a track fills as many placeholders as its widest line shows', () => {
  expect(mostCols('[--cols:3] sm:[--cols:4] lg:[--cols:5] xl:[--cols:6]')).toBe(6)
  expect(mostCols('auto-cols-[42%] sm:auto-cols-(--span) sm:[--cols:3] xl:[--cols:5] lg:[--cols:4]')).toBe(5)
})
