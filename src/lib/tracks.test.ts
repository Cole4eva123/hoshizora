import { expect, test } from 'bun:test'
import type { Track, Version } from '@/lib/emby'
import { en, zh } from '@/lib/i18n'
import { audioLabel, picksOf, qualityOf, subtitleLabel, subtitlesOf } from '@/lib/tracks'

// Versions as the user's server has them (2026-10-09): X加Y, a 4K file read long ago; 春江水暖, a .strm read once; and
// a .strm it hasn't read, known only by its name.
const track = (index: number, more: Partial<Track> = {}): Track => ({ index, default: false, forced: false, ...more })
const xy: Version = {
  id: 'x',
  name: 'X加Y',
  video: { width: 3840, height: 1600, range: 'HDR 10' },
  audio: [
    track(1, { language: 'eng', codec: 'dts', channels: 8, default: true }),
    track(2, { language: 'eng', codec: 'ac3', channels: 2, title: 'Commentary with Director Bryan Singer' }),
  ],
  subtitles: [
    track(3, { language: 'eng', codec: 'subrip', title: 'Forced SRT', default: true, forced: true }),
    track(4, { language: 'eng', codec: 'PGSSUB', title: 'Forced' }),
    track(6, { language: 'eng', codec: 'subrip', title: 'SDH SRT' }),
    track(9, { language: 'fre', codec: 'PGSSUB' }),
  ],
}
const spring: Version = {
  id: 's',
  name: '1080p - BluRay',
  video: { width: 1920, height: 1080, range: 'SDR' },
  audio: [track(1, { codec: 'ac3', channels: 6, default: true })],
  subtitles: [
    track(2, { language: 'chi', codec: 'PGSSUB', title: 'cht' }),
    track(3, { language: 'chi', codec: 'PGSSUB', title: 'chs', default: true }),
  ],
}
const strm = (name: string): Version => ({ id: 'u', name, audio: [], subtitles: [] })

test('qualityOf names a version by the size of its picture, or else as its name says', () => {
  expect(qualityOf(xy)).toBe('4K HDR10')
  expect(qualityOf(spring)).toBe('1080p')
  // a 4:3 or anamorphic 1080p, and a 4K wider than tall by 3:2
  expect(qualityOf({ ...spring, video: { width: 1440, height: 1080 } })).toBe('1080p')
  expect(qualityOf({ ...spring, video: { width: 3780, height: 2520 } })).toBe('4K')
  expect(qualityOf({ ...spring, video: { width: 2560, height: 1440 } })).toBe('1440p')
  // read without its size: as its name says
  expect(qualityOf({ ...strm('2160p - WEB-DL'), video: { width: 0, height: 0 } })).toBe('4K')
  expect(qualityOf(strm('2160p - WEB-DL HQ'))).toBe('4K')
  expect(qualityOf(strm('4k'))).toBe('4K')
  expect(qualityOf(strm('Bleach.2004.S01E010.1080P.AI'))).toBe('1080p')
  expect(qualityOf(strm('春江水暖'))).toBeUndefined()
  expect(qualityOf(strm('DVDRip'))).toBeUndefined()
})

test('tracks are named in the language shown, 简体 and 繁体中文 told apart by their titles', () => {
  expect(xy.audio.map((a) => audioLabel(a, zh))).toEqual(['英语 DTS 7.1', '英语 AC3 立体声 评论'])
  expect(xy.audio.map((a) => audioLabel(a, en))).toEqual(['English DTS 7.1', 'English AC3 stereo Commentary'])
  expect(audioLabel(spring.audio[0], zh)).toBe('AC3 5.1')
  expect(xy.subtitles.map((s) => subtitleLabel(s, zh))).toEqual(['英语 强制 SRT', '英语 强制 PGS', '英语 SDH SRT', '法语 PGS'])
  expect(spring.subtitles.map((s) => subtitleLabel(s, zh))).toEqual(['繁体中文 PGS', '简体中文 PGS'])
  expect(subtitleLabel(track(5, { codec: 'ass' }), en)).toBe('Unknown language ASS')
})

test('picksOf starts on the default 音轨, and on a 字幕 in the language shown when the 音轨 is in another', () => {
  // English spoken, no Chinese 字幕: the file's default (forced English); in English, the forced one in it
  expect(picksOf(xy, zh)).toEqual({ audio: 1, subtitle: 3 })
  expect(picksOf(xy, en)).toEqual({ audio: 1, subtitle: 3 })
  // an 音轨 that doesn't say its language: 简体 for Chinese, though 繁体 comes first in the file
  expect(picksOf(spring, zh)).toEqual({ audio: 1, subtitle: 3 })
  expect(picksOf({ ...xy, subtitles: xy.subtitles.slice(2) }, en)).toEqual({ audio: 1, subtitle: -1 })
  expect(picksOf(strm('4k'), zh)).toEqual({ audio: -1, subtitle: -1 })
  // a whole one before a forced one of only a few lines, though the forced one comes first and says chs
  const forced = track(4, { language: 'chi', title: 'chs forced', forced: true })
  const forcedFirst = { ...spring, subtitles: [forced, ...spring.subtitles] }
  expect(picksOf(forcedFirst, zh)).toEqual({ audio: 1, subtitle: 3 })
  // tagged with its script, as an external .zh-Hans.srt is
  const tagged = { ...spring, subtitles: [track(5, { language: 'zh-Hant' }), track(6, { language: 'zh-Hans' })] }
  expect(picksOf(tagged, zh)).toEqual({ audio: 1, subtitle: 6 })
  expect(tagged.subtitles.map((s) => subtitleLabel(s, zh))).toEqual(['繁体中文', '简体中文'])
  // titled in English, and a name that merely holds the letters
  const titled = [
    track(7, { language: 'chi', title: 'Chinese (Traditional)' }),
    track(8, { language: 'chi', title: 'Chinese (Simplified)' }),
    track(9, { language: 'chi', title: 'Hans Zimmer interview' }),
  ]
  expect(picksOf({ ...spring, subtitles: titled }, zh)).toEqual({ audio: 1, subtitle: 8 })
  expect(titled.map((s) => subtitleLabel(s, zh))).toEqual(['繁体中文', '简体中文', '中文'])
})

test('subtitlesOf offers those in the language shown first', () => {
  const both = { ...spring, subtitles: [track(1, { language: 'eng' }), ...spring.subtitles] }
  expect(subtitlesOf(both, zh).map((s) => s.index)).toEqual([2, 3, 1])
  expect(subtitlesOf(both, en).map((s) => s.index)).toEqual([1, 2, 3])
})
