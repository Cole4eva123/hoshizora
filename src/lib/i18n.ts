import { useSyncExternalStore } from 'react'
import { storage, storageKey } from '@/lib/utils'

// 界面语言。文案中英两份写在一起，由 `t` 挑出显示的那份：t('首页', 'Home')。其他随语言变的东西也走它，JSX 和
// locale（t('zh-CN', 'en-US')）都算。
// 泛型 V 让 t 能挑任何类型（字符串、JSX、数字），并要求中英两份是同一种类型。
export type Translate = <V>(zh: V, en: V) => V
// 仅有的两个 t：zh 返回第一个参数，en 返回第二个（`_` 占住用不到的第一个）。当前语言就是当前用的哪个函数。
export const zh: Translate = (text) => text
export const en: Translate = (_, text) => text
// 显示的语言写成 BCP 47 标签（TMDB 的 language=、Intl 的各种格式、<html lang>），和只取语言那一段（Emby 音轨的语言、
// 记在设备上的选择）。
export const localeOf = (t: Translate) => t('zh-CN', 'en-US')
export const langOf = (t: Translate) => t('zh', 'en')
// 几项连成一句，按显示的语言："IMDb、烂番茄和MyAnimeList"，"IMDb, Rotten Tomatoes, and MyAnimeList"；或者只是并排
// 列出的名字（类型、收藏夹）："剧情、喜剧"，"Drama, Comedy"。Intl 的并列写法在中文里不加任何分隔，所以后者自己连。
export const listOf = (items: string[], t: Translate) => new Intl.ListFormat(localeOf(t)).format(items)
export const namesOf = (items: string[], t: Translate) => items.join(t('、', ', '))
// 存在列表里的文案，比如菜单链接或分类的名字：两种语言都存，用 t(...copy) 挑。
export type Copy = [zh: string, en: string]

// 记在这台设备上：没选过英文就是中文。没有 storage（被屏蔽，或在 bun test 下）时，选择只保留到页面关闭。
const key = storageKey('lang')
// 显示的语言，存的是它的 `t`（就是 zh 或 en 本身）。放在模块里而不是 Context 里，LangSwitch 改它、任何组件读它，
// 都不用在应用外面包一层 Provider。
// 存着的选择读成它的 `t`：存的是 'en' 就是英文，其余（没选过）都是中文。
const stored = (value?: string | null) => (value === langOf(en) ? en : zh)
let shown: Translate = stored(storage?.getItem(key))
// 用 useT 绘制的组件。组件挂载时 React 调 subscribe，卸载时调它返回的函数。
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// 由 LangSwitch 调用。通知每个用 useT 绘制的组件重绘，再记住这次选择：存 'zh' 还是 'en'，由新的 `t` 自己挑。
export function setLang(lang: Translate) {
  shown = lang
  listeners.forEach((l) => l())
  storage?.setItem(key, langOf(lang))
}

// 另一个窗口换了语言（在主窗口换，播放窗口跟着）：跟着换，只通知重绘，不再存一遍。没有 window（bun test）时不听。
globalThis.window?.addEventListener('storage', (e) => {
  if (e.key !== key) return
  shown = stored(e.newValue)
  listeners.forEach((l) => l())
})

// 显示语言的 `t`。调用它的组件会在语言切换时重绘，所以每个有自己文案的组件都自己调它，不从父组件接 `t`。React 会拿
// 读到的 `t` 和上一次比：zh 和 en 是两个固定的函数，语言没变就是同一个函数，什么都不重绘。
export const useT = () => useSyncExternalStore(subscribe, () => shown)
