import { expect, test } from 'bun:test'
import type { Track, Version } from '@/lib/emby'
import { en, zh } from '@/lib/i18n'
import { asideOf, audioLabel, picksOf, releaseNameOf, specOf, subtitleLabel, subtitlesOf } from '@/lib/tracks'

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

test('releaseNameOf names a version by its file from the 清晰度 on, as a release names itself', () => {
  // files on the user's server (2026-10-10): a release, one named by a media manager, and .strm links
  const named = (file: string) => releaseNameOf({ ...strm('2160p - WEB-DL'), file })
  expect(named('Crisis.Negotiators.2024.2160p.WEB-DL.H265.HDR.DDP5.1.2Audio-DreamHD.mkv')).toBe(
    '2160p.WEB-DL.H265.HDR.DDP5.1.2Audio-DreamHD',
  )
  expect(named('一路超平安 (2026) [tmdb-1761059] - 2160p - WEB-DL HDR10 HQ.mp4')).toBe('2160p - WEB-DL HDR10 HQ')
  expect(named('%E6%83%8A%E5%A4%A9%E8%90%A5%E6%95%91%20%282020%29%20-%202160p.mkv')).toBe('2160p')
  // no 清晰度 in it or the server's name: the whole name; a % of its own; no file known: the server's name
  expect(releaseNameOf({ ...strm('朋友'), file: '%E3%80%90540%E3%80%91%E6%9C%8B%E5%8F%8B.1974.mkv' })).toBe('【540】朋友.1974')
  // a link's last part that's an id, where the server's name says the 清晰度
  expect(named('9f8a7b6c')).toBe('2160p - WEB-DL')
  expect(named('Movie.100%.Pure.4K.HDR.mkv')).toBe('4K.HDR')
  expect(releaseNameOf(strm('2160p - WEB-DL'))).toBe('2160p - WEB-DL')
})

test('specOf says what a version plays at: bitrate, height and range', () => {
  const at = (bitrate: number, height: number, range?: string) =>
    specOf({ ...strm(''), bitrate, video: { width: 3840, height, range } })
  expect(at(14.9e6, 1920, 'SDR')).toBe('14.9mbps 1920P SDR')
  expect(at(16_111_679, 1604, 'HDR 10')).toBe('16.1mbps 1604P HDR10')
  expect(at(14_426_506, 1608, 'DolbyVision')).toBe('14.4mbps 1608P DV')
  expect(specOf(spring)).toBe('1080P SDR')
  expect(specOf(strm('2160p'))).toBe('')
})

test("asideOf keeps what a 字幕's title adds to its name, and drops what it repeats", () => {
  const aside = (more: Partial<Track>) => asideOf(track(2, more), zh)
  expect(aside({ language: 'spa', title: 'European' })).toBe('European')
  expect(aside({ language: 'por', title: 'Brazilian' })).toBe('Brazilian')
  expect(aside({ language: 'chi', title: 'Simplified' })).toBeUndefined()
  expect(aside({ language: 'chi', title: 'Big5' })).toBeUndefined()
  expect(aside({ language: 'eng', title: 'English' })).toBeUndefined()
  expect(aside({ language: 'pt-BR', title: 'Brazilian Portuguese' })).toBeUndefined()
  expect(xy.subtitles.map((s) => asideOf(s, zh))).toEqual([undefined, undefined, undefined, undefined])
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
