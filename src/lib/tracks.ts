import type { Track, Version } from '@/lib/emby'
import type { Translate } from '@/lib/i18n'

// What a 片源's versions and tracks are called on the page, and which a version starts on: rules of naming, apart
// from asking Emby (emby.ts), as they change with the words the page uses.

// 4K, 1440p, 1080p, 720p by the size of the picture (a 4K film may be 1600 high); for a version the server hasn't read,
// or read without its size, as its name says it, the way servers name versions ("2160p - WEB-DL").
const sizeOf = ({ video: p, name }: Version) => {
  if (!p?.width && !p?.height)
    return /\b(2160p|4k|uhd)\b/i.test(name) ? '4K' : name.match(/\b(1440|1080|720|576|480)p\b/i)?.[0].toLowerCase()
  // either side, as a film may be wider than 16:9 and a 4:3 or anamorphic transfer narrower
  if (p.width >= 3800 || p.height >= 2100) return '4K'
  if (p.width >= 2500 || p.height >= 1400) return '1440p'
  if (p.width >= 1900 || p.height >= 1060) return '1080p'
  if (p.width >= 1260 || p.height >= 700) return '720p'
  return p.height ? `${p.height}p` : undefined
}

// A version's 清晰度: its size (sizeOf), and its range when that's more than SDR. None when neither says.
export function qualityOf(v: Version) {
  const range = v.video?.range && v.video.range !== 'SDR' ? v.video.range.replace('HDR ', 'HDR') : undefined
  return [sizeOf(v), range].filter(Boolean).join(' ') || undefined
}

// Languages named in the language shown. Emby names them by ISO 639-2, often by the older codes (chi, fre, ger),
// which the app's WebKit names too, and a file may by a tag with its region or script (zh-CN, zh-Hans, en-US); two
// codes are one language when their languages, the tag's first part, have one name.
const languages = {
  zh: new Intl.DisplayNames(['zh'], { type: 'language' }),
  en: new Intl.DisplayNames(['en'], { type: 'language' }),
}
const named = (code: string, lang: 'zh' | 'en') => {
  try {
    return languages[lang].of(code)
  } catch {
    return undefined // not a language code at all
  }
}
const base = (code: string) => code.split(/[-_]/)[0]
const isIn = (tr: Track, code: string) => !!tr.language && named(base(tr.language), 'en') === named(code, 'en')
// Chinese told apart as files title it (chs and cht, 简 and 繁, Simplified and Traditional) or tag it (zh-Hans,
// zh-CN; zh-Hant, zh-TW)
const simplified = (tr: Track) =>
  /chs|简|simplified|\bsc\b|\bgb\b/i.test(tr.title ?? '') || /[-_](hans|cn|sg)\b/i.test(tr.language ?? '')
const traditional = (tr: Track) =>
  /cht|繁|traditional|\btc\b|big5/i.test(tr.title ?? '') || /[-_](hant|tw|hk|mo)\b/i.test(tr.language ?? '')
const forced = (tr: Track) => tr.forced || /forced|强制/i.test(tr.title ?? '')

// A track's language in the language shown, 简体 and 繁体中文 apart; none when the file doesn't say.
function languageOf(tr: Track, t: Translate) {
  if (!tr.language || tr.language === 'und') return
  if (isIn(tr, 'zh') && simplified(tr)) return t('简体中文', 'Simplified Chinese')
  if (isIn(tr, 'zh') && traditional(tr)) return t('繁体中文', 'Traditional Chinese')
  return named(tr.language, t('zh', 'en')) ?? tr.language
}

const codecs: Record<string, string> = {
  truehd: 'TrueHD',
  eac3: 'E-AC3',
  subrip: 'SRT',
  pgssub: 'PGS',
  dvdsub: 'VobSub',
}
const codecOf = (c?: string) => c && (codecs[c.toLowerCase()] ?? (/^pcm/i.test(c) ? 'PCM' : c.toUpperCase()))
const channelsOf = (n: number | undefined, t: Translate) =>
  ({ 1: t('单声道', 'mono'), 2: t('立体声', 'stereo'), 6: '5.1', 8: '7.1' })[n ?? 0] ?? (n && t(`${n} 声道`, `${n} ch`))
// what a track's title says that its language doesn't: for the deaf and hard of hearing, or a commentary
const notesOf = (tr: Track, t: Translate) => [
  /sdh/i.test(tr.title ?? '') && 'SDH',
  /comment|评论|解说/i.test(tr.title ?? '') && t('评论', 'Commentary'),
]

// An 音轨 in words: its language, how it's coded, its channels, and what its title adds.
export const audioLabel = (a: Track, t: Translate) =>
  [languageOf(a, t), codecOf(a.codec), channelsOf(a.channels, t), ...notesOf(a, t)].filter(Boolean).join(' ')
// A 字幕 in words: its language, 强制 for one of only what isn't spoken in the 音轨's language, what its title adds,
// and how it's coded (PGS is pictures, SRT and ASS are text), as two of one language often differ only there.
export const subtitleLabel = (s: Track, t: Translate) =>
  [
    languageOf(s, t) ?? t('未标语言', 'Unknown language'),
    forced(s) && t('强制', 'Forced'),
    ...notesOf(s, t),
    codecOf(s.codec),
  ]
    .filter(Boolean)
    .join(' ')

// The 音轨 and 字幕 a version starts on, by index, -1 for none: the file's default 音轨, else its first; a whole 字幕 in
// the language shown when the 音轨 isn't in it (简体 first among Chinese ones), else the file's default 字幕; and with
// the 音轨 in the language shown, only a forced 字幕 in it, for what isn't spoken in it.
export function picksOf(v: Version, t: Translate) {
  const shown = t('zh', 'en')
  const audio = v.audio.find((a) => a.default) ?? v.audio[0]
  const mine = v.subtitles.filter((s) => isIn(s, shown))
  // a whole one, not a forced one of only a few lines
  const whole = mine.filter((s) => !forced(s))
  const subtitle =
    audio && isIn(audio, shown)
      ? mine.find(forced)
      : (whole.find(simplified) ?? whole[0] ?? v.subtitles.find((s) => s.default))
  return { audio: audio?.index ?? -1, subtitle: subtitle?.index ?? -1 }
}

// The 字幕 in the order offered: those in the language shown first, each kept in the file's order.
export const subtitlesOf = (v: Version, t: Translate) => {
  const shown = t('zh', 'en')
  return [...v.subtitles.filter((s) => isIn(s, shown)), ...v.subtitles.filter((s) => !isIn(s, shown))]
}
