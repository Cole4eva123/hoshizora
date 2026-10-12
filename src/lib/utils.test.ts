import { expect, test } from 'bun:test'
import { cn, mostCols } from '@/lib/utils'

test('a track fills as many placeholders as its widest line shows', () => {
  expect(mostCols('[--cols:3] sm:[--cols:4] lg:[--cols:5] xl:[--cols:6]')).toBe(6)
  expect(mostCols('auto-cols-[42%] sm:auto-cols-(--span) sm:[--cols:3] xl:[--cols:5] lg:[--cols:4]')).toBe(5)
})

test("the theme's sizes and glows merge as sizes and glows, not as colours", () => {
  expect(cn('text-body text-muted-foreground')).toBe('text-body text-muted-foreground')
  expect(cn('text-sm text-muted-foreground', 'text-detail')).toBe('text-muted-foreground text-detail')
  expect(cn('after:shadow-dot-lg after:shadow-(color:--glow)')).toBe('after:shadow-dot-lg after:shadow-(color:--glow)')
  expect(cn('shadow-lit outline-star/70', 'shadow-dot')).toBe('outline-star/70 shadow-dot')
  expect(cn('[&_svg]:drop-shadow-glow text-star')).toBe('[&_svg]:drop-shadow-glow text-star')
})

test('every size and glow index.css adds to the theme is one cn merges as such', async () => {
  const css = await Bun.file(`${import.meta.dir}/../index.css`).text()
  const names = (scale: string, name = '[a-z-]+') =>
    [...css.matchAll(new RegExp(`^\\s*--${scale}-(${name}):`, 'gm'))].map((m) => m[1])
  // a size of the theme's replaces a size, and leaves the colour
  for (const n of names('text', '[a-z]+')) expect(cn('text-sm text-star', `text-${n}`)).toBe(`text-star text-${n}`)
  for (const n of names('shadow')) expect(cn('shadow-sm shadow-(color:--glow)', `shadow-${n}`)).toBe(`shadow-(color:--glow) shadow-${n}`)
  for (const n of names('drop-shadow')) expect(cn('drop-shadow-sm', `drop-shadow-${n}`)).toBe(`drop-shadow-${n}`)
  for (const n of names('text-shadow')) expect(cn('text-shadow-sm text-star', `text-shadow-${n}`)).toBe(`text-star text-shadow-${n}`)
  // and the scan found them, so the loops above checked something
  expect(names('text', '[a-z]+').length && names('shadow').length).toBeGreaterThan(0)
})
