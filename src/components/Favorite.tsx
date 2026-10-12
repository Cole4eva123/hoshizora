import { useId } from 'react'
import { Plus } from 'lucide-react'
import { Constellation, Filled } from '@/components/Constellation'
import { Menu, Option } from '@/components/Sources'
import { addFolder, has, toggleIn, useFavorites } from '@/lib/favorites'
import { useT } from '@/lib/i18n'
import type { Card } from '@/lib/tmdb'
import { cn, pentagram } from '@/lib/utils'

// 收藏, on a 作品's 画报墙 after 字幕 (a series', after 片源): its list has the 收藏夹 as checkboxes, and a field for a
// new one the 作品 goes straight into. Once it's in one, the star is filled with light and the word under it names the
// 收藏夹.
export function Favorite({ m }: { m: Card }) {
  const t = useT()
  const name = useId()
  const { folders } = useFavorites()
  const inside = folders.filter((f) => has(f, m))
  return (
    <Menu
      kind="favorite"
      label={t('收藏', 'Save')}
      lit={inside.length > 0}
      word={
        inside.length > 1
          ? t(`${inside[0].name} 等 ${inside.length} 个`, `${inside[0].name} +${inside.length - 1}`)
          : inside[0]?.name
      }
      current={inside.map((f) => f.name).join(t('、', ', ')) || undefined}
      icon={(className) =>
        inside.length ? (
          <Filled line={pentagram[0]} className={className} />
        ) : (
          <Constellation lines={pentagram} className={className} />
        )
      }
    >
      {folders.map((f) => (
        <Option
          key={f.id}
          type="checkbox"
          name={name}
          picked={has(f, m)}
          onPick={() => toggleIn(f.id, m)}
          label={f.name}
          detail={t(`${f.titles.length} 部`, `${f.titles.length} title${f.titles.length === 1 ? '' : 's'}`)}
        />
      ))}
      <NewFolder m={m} className="rounded-lg px-2.5 py-2 focus-within:bg-star/6" />
    </Menu>
  )
}

// A field that names a new 收藏夹, made on Enter: with `m`, the 作品 goes in it; `onAdd` gets its id.
export function NewFolder({ m, onAdd, className }: { m?: Card; onAdd?: (id: string) => void; className?: string }) {
  const t = useT()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const name = String(new FormData(e.currentTarget).get('name')).trim()
        // not onAdd?.(addFolder(…)): without onAdd, `?.` would skip making it
        if (name) {
          const folder = addFolder(name, m)
          onAdd?.(folder)
        }
        e.currentTarget.reset()
      }}
      className={cn('flex items-center gap-2 text-star/70 transition-colors focus-within:text-star', className)}
    >
      <Plus className="size-4 shrink-0" strokeWidth={1.5} />
      <input
        name="name"
        aria-label={t('新建收藏夹', 'New list')}
        placeholder={t('新建收藏夹', 'New list')}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-name outline-none placeholder:text-star/60"
      />
    </form>
  )
}
