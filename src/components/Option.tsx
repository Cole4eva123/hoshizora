import { type ReactNode, useRef } from 'react'
import type { readAheadOn } from '@/lib/emby'
import { cn } from '@/lib/utils'

// The lists of the 作品 page's `Menu` and the player's 音轨 and 字幕, in a file of their own, so the player's page takes
// them without the 作品 page's Emby.

// A list of Options under its icon and name, opening from the button whose popoverTarget is its `id` (a native popover,
// placed and drawn by the caller's classes): a pointer's pick or Enter puts it away, as a menu's does, where the arrow
// keys move through it, picking as they go, and a tick of a checkbox (one of several) leave it open.
export function OptionList({
  id,
  label,
  icon,
  onToggle,
  className,
  children,
}: {
  id: string
  label: string
  icon: ReactNode
  onToggle?: (open: boolean) => void
  className: string
  children: ReactNode
}) {
  const arrows = useRef(false)
  return (
    <div
      id={id}
      popover="auto"
      onToggle={(e) => onToggle?.(e.newState === 'open')}
      onPointerDown={() => (arrows.current = false)}
      onKeyDown={(e) => {
        arrows.current = e.key.startsWith('Arrow')
        // an option's: not a 重试 button's, nor a field's, which submits its form
        const option = e.target instanceof HTMLInputElement && (e.target.type === 'radio' || e.target.type === 'checkbox')
        if (e.key !== 'Enter' || !option) return
        e.preventDefault() // or the focus, back on the button, takes the Enter and opens the list again
        e.currentTarget.hidePopover()
      }}
      onChange={(e) => arrows.current || (e.target as HTMLInputElement).type !== 'radio' || e.currentTarget.hidePopover()}
      className={cn(
        'inset-auto m-0 w-max min-w-48 overflow-y-auto overscroll-contain rounded-xl border-0 p-1 text-foreground shadow-2xl shadow-night open:animate-in open:fade-in',
        // centred in the window where WebKit places nothing by anchors (before Safari 26)
        'not-supports-[anchor-name:--a]:inset-0 not-supports-[anchor-name:--a]:m-auto',
        className,
      )}
    >
      <fieldset className="min-w-0">
        <legend className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-detail text-muted-foreground">
          {icon}
          {label}
        </legend>
        {children}
      </fieldset>
    </div>
  )
}

// One option in a list: a radio (or of `type` checkbox, one of several ticked) drawn as its name, a word `aside` it and
// a line of `detail` under it (what a 版本 plays at), the picked one starred and brighter.
export function Option({
  type = 'radio',
  name,
  picked,
  onPick,
  intent,
  mark,
  label,
  aside,
  detail,
}: {
  type?: 'radio' | 'checkbox'
  name: string
  picked: boolean
  onPick: () => void
  intent?: ReturnType<typeof readAheadOn>
  mark?: ReactNode
  label: string
  aside?: string
  detail?: string
}) {
  return (
    <label
      {...intent}
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-star/6 hover:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring',
        picked ? 'text-foreground' : 'text-foreground/60',
      )}
    >
      <input type={type} name={name} checked={picked} onChange={onPick} className="sr-only" />
      {/* the star, centred on the name's line (leading-5) */}
      <span className="flex h-5 shrink-0 items-center">
        <span className={cn('size-1.5 rounded-full bg-star shadow-dot shadow-(color:--glow)', !picked && 'opacity-0')} />
      </span>
      <span className="min-w-0">
        <span title={label} className="flex items-center gap-1.5 text-name leading-5 whitespace-nowrap">
          {mark}
          <span className="truncate">{label}</span>
          {aside && <span className="text-detail text-muted-foreground">{aside}</span>}
        </span>
        {detail && <span className="block text-detail leading-4 text-muted-foreground tabular-nums">{detail}</span>}
      </span>
    </label>
  )
}
