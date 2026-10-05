import { useSyncExternalStore } from 'react'

// The 界面语言. Copy is written in both languages side by side and `t` picks the one shown: t('首页', 'Home'). Anything
// else that differs by language goes through it too, JSX and locales (t('zh-CN', 'en-US')) included.
export type Translate = <V>(zh: V, en: V) => V
export const zh: Translate = (text) => text
export const en: Translate = (_, text) => text
// Copy kept in a list, like a menu link's or a 分类's name: both languages, picked with t(...copy).
export type Copy = [zh: string, en: string]

// Remembered on this device: Chinese until English is picked. Without storage (blocked, or under bun test) a pick
// lasts until the page is closed. The key is the app's own, as every app on the github.io origin shares the storage.
const storage = (() => {
  try {
    return localStorage
  } catch {
    return undefined
  }
})()
const key = 'mp2.lang'
let shown: Translate = storage?.getItem(key) === 'en' ? en : zh
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setLang(lang: Translate) {
  shown = lang
  listeners.forEach((l) => l())
  storage?.setItem(key, lang('zh', 'en'))
}

// The `t` of the language shown. A component that calls it is drawn again when the language changes, so each one with
// copy of its own calls it, rather than taking `t` from its parent.
export const useT = () => useSyncExternalStore(subscribe, () => shown)
