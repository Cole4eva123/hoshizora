import { useSyncExternalStore } from 'react'
import { storage } from '@/lib/utils'

// 界面语言。文案中英两份写在一起，由 `t` 挑出显示的那份：t('首页', 'Home')。其他随语言变的东西也走它，JSX 和
// locale（t('zh-CN', 'en-US')）都算。
// 泛型 V 让 t 能挑任何类型（字符串、JSX、数字），并要求中英两份是同一种类型。
export type Translate = <V>(zh: V, en: V) => V
// 仅有的两个 t：zh 返回第一个参数，en 返回第二个（`_` 占住用不到的第一个）。当前语言就是当前用的哪个函数。
export const zh: Translate = (text) => text
export const en: Translate = (_, text) => text
// 存在列表里的文案，比如菜单链接或分类的名字：两种语言都存，用 t(...copy) 挑。
export type Copy = [zh: string, en: string]

// 记在这台设备上：没选过英文就是中文。没有 storage（被屏蔽，或在 bun test 下）时，选择只保留到页面关闭。key 带上
// 本应用的前缀，因为 github.io 同一个源下的所有应用共用这份 storage。
const key = 'mp2.lang'
// 显示的语言，存的是它的 `t`（就是 zh 或 en 本身）。放在模块里而不是 Context 里，LangSwitch 改它、任何组件读它，
// 都不用在应用外面包一层 Provider。
let shown: Translate = storage?.getItem(key) === 'en' ? en : zh
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
  storage?.setItem(key, lang('zh', 'en'))
}

// 显示语言的 `t`。调用它的组件会在语言切换时重绘，所以每个有自己文案的组件都自己调它，不从父组件接 `t`。React 会拿
// 读到的 `t` 和上一次比：zh 和 en 是两个固定的函数，语言没变就是同一个函数，什么都不重绘。
export const useT = () => useSyncExternalStore(subscribe, () => shown)
