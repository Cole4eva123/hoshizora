import type { Track, Version } from '@/lib/emby'
import { type Translate, langOf } from '@/lib/i18n'

// What a 片源's versions and tracks are called on the page, and which a version starts on: rules of naming, apart
// from asking Emby (emby.ts), as they change with the words the page uses.

const quality = /\b(2160|1440|1080|720|576|480)[pi]\b|\b(4k|uhd)\b/i

// A version by its release, as its file names it from the 清晰度 on (2160p.AMZN.WEB-DL.DDP5.1.H265-NTb), the 作品's
// own name and year before it dropped. A file that names no 清晰度 goes by the server's name for the version when that
// does (a link's last part may be an id), else by its whole name; one not known, by the server's name.
// ponytail: decodes every name, as a .strm's link keeps it encoded; a name on disk with a %20 of its own shows decoded.
// Have emby-core decode links only if one turns up.
export function releaseNameOf({ file, name }: Version) {
  if (!file) return name
  let release = file.replace(/\.(mkv|mp4|m4v|avi|ts|m2ts|iso|mov|wmv|webm|flv|rmvb|strm)$/i, '')
  try {
    release = decodeURIComponent(release)
  } catch {
    // a name with a % of its own
  }
  const at = release.search(quality)
  return at < 0 && quality.test(name) ? name : release.slice(Math.max(at, 0))
}

// What a version plays at, as a release lists it: its bitrate, its picture's height and its range (14.9mbps 1920P
// SDR). Empty till the server has read it.
export const specOf = ({ bitrate, video }: Version) =>
  [
    bitrate && `${(bitrate / 1e6).toFixed(1)}mbps`,
    video?.height && `${video.height}P`,
    video?.range && (/dolby\s*vision/i.test(video.range) ? 'DV' : video.range.replaceAll(' ', '')),
  ]
    .filter(Boolean)
    .join(' ')

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
// What a track is named by, as Emby lists it on the 作品 page and mpv in the player.
type Named = Pick<Track, 'language' | 'title' | 'codec' | 'channels' | 'forced'>
const isIn = (tr: Named, code: string) => !!tr.language && named(base(tr.language), 'en') === named(code, 'en')
// Chinese told apart as files title it (chs and cht, 简 and 繁, Simplified and Traditional) or tag it (zh-Hans,
// zh-CN; zh-Hant, zh-TW)
const simplified = (tr: Named) =>
  /chs|简|simplified|\bsc\b|\bgb\b/i.test(tr.title ?? '') || /[-_](hans|cn|sg)\b/i.test(tr.language ?? '')
const traditional = (tr: Named) =>
  /cht|繁|traditional|\btc\b|big5/i.test(tr.title ?? '') || /[-_](hant|tw|hk|mo)\b/i.test(tr.language ?? '')
const forced = (tr: Named) => tr.forced || /forced|强制/i.test(tr.title ?? '')

// A track's language in the language shown, 简体 and 繁体中文 apart; none when the file doesn't say.
function languageOf(tr: Named, t: Translate) {
  if (!tr.language || tr.language === 'und') return
  if (isIn(tr, 'zh') && simplified(tr)) return t('简体中文', 'Simplified Chinese')
  if (isIn(tr, 'zh') && traditional(tr)) return t('繁体中文', 'Traditional Chinese')
  return named(tr.language, langOf(t)) ?? tr.language
}

const codecs: Record<string, string> = {
  truehd: 'TrueHD',
  eac3: 'E-AC3',
  subrip: 'SRT',
  pgssub: 'PGS',
  dvdsub: 'VobSub',
  // mpv's names for them, in the player
  hdmv_pgs_subtitle: 'PGS',
  dvd_subtitle: 'VobSub',
}
const codecOf = (c?: string) => c && (codecs[c.toLowerCase()] ?? (/^pcm/i.test(c) ? 'PCM' : c.toUpperCase()))
const channelsOf = (n: number | undefined, t: Translate) =>
  ({ 1: t('单声道', 'mono'), 2: t('立体声', 'stereo'), 6: '5.1', 8: '7.1' })[n ?? 0] ?? (n && t(`${n} 声道`, `${n} ch`))
// what a track's title says that its language doesn't: for the deaf and hard of hearing, or a commentary
const notesOf = (tr: Named, t: Translate) => [
  /sdh/i.test(tr.title ?? '') && 'SDH',
  /comment|评论|解说/i.test(tr.title ?? '') && t('评论', 'Commentary'),
]

// An 音轨 in words: its language, how it's coded, its channels, and what its title adds.
export const audioLabel = (a: Named, t: Translate) =>
  [languageOf(a, t), codecOf(a.codec), channelsOf(a.channels, t), ...notesOf(a, t)].filter(Boolean).join(' ')
// A 字幕 in words: its language, 强制 for one of only what isn't spoken in the 音轨's language, what its title adds,
// and how it's coded (PGS is pictures, SRT and ASS are text), as two of one language often differ only there.
export const subtitleLabel = (s: Named, t: Translate) =>
  [
    languageOf(s, t) ?? t('未标语言', 'Unknown language'),
    forced(s) && t('强制', 'Forced'),
    ...notesOf(s, t),
    codecOf(s.codec),
  ]
    .filter(Boolean)
    .join(' ')

// What a 字幕's title in the file adds to its name (European, Brazilian), as two of one language may differ only there;
// none when it says only what the name does: its language, 简繁, 强制, SDH or a commentary.
export function asideOf(tr: Named, t: Translate) {
  const title = tr.title?.trim()
  if (!title || simplified(tr) || traditional(tr) || forced(tr) || notesOf(tr, t).some(Boolean)) return
  const code = tr.language && base(tr.language)
  // as the tag names it too (pt-BR, Brazilian Portuguese)
  const names = code
    ? [code, ...[code, tr.language!].flatMap((c) => [named(c, 'en'), named(c, 'zh')])]
    : []
  return names.some((n) => n?.toLowerCase() === title.toLowerCase()) ? undefined : title
}

// The index that stands for no 音轨 or 字幕, as Emby takes it for playing without one.
export const noTrack = -1

// The 音轨 and 字幕 a version starts on, by index, noTrack for none: the file's default 音轨, else its first; a whole 字幕 in
// the language shown when the 音轨 isn't in it (简体 first among Chinese ones), else the file's default 字幕; and with
// the 音轨 in the language shown, only a forced 字幕 in it, for what isn't spoken in it.
export function picksOf(v: Version, t: Translate) {
  const shown = langOf(t)
  const audio = v.audio.find((a) => a.default) ?? v.audio[0]
  const mine = v.subtitles.filter((s) => isIn(s, shown))
  // a whole one, not a forced one of only a few lines
  const whole = mine.filter((s) => !forced(s))
  const subtitle =
    audio && isIn(audio, shown)
      ? mine.find(forced)
      : (whole.find(simplified) ?? whole[0] ?? v.subtitles.find((s) => s.default))
  return { audio: audio?.index ?? noTrack, subtitle: subtitle?.index ?? noTrack }
}

// The 字幕 in the order offered, on the 作品 page and in the player: those in the language shown first, each kept in
// the file's order.
export const subtitlesOf = <T extends Named>(subtitles: T[], t: Translate) => {
  const shown = langOf(t)
  return [...subtitles.filter((s) => isIn(s, shown)), ...subtitles.filter((s) => !isIn(s, shown))]
}
