import { useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Choices } from '@/components/Choices'
import { Constellation, Filled } from '@/components/Constellation'
import { NewFolder } from '@/components/Favorite'
import { Page } from '@/components/Page'
import { PosterCard, posterGrid } from '@/components/PosterRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type Folder, isWatched, removeFolder, renameFolder, toggleWatched, useFavorites } from '@/lib/favorites'
import { useT } from '@/lib/i18n'
import { type Card, type From, hrefOf, lineupOf, titleOf } from '@/lib/tmdb'
import { choice, cn, dialogBox, play, sliders } from '@/lib/utils'

// 看过: the logo's play triangle, filled with light once the 作品 has been watched.
const Played = ({ on, className }: { on: boolean; className: string }) =>
  on ? <Filled line={play[0]} className={className} /> : <Constellation lines={play} className={className} />

// The 收藏夹 on one line, each its name and counts, starred when picked, and a field for a new one at their end; then
// 全部 / 没看过 / 看过 (?show=) and the picked one's settings. Under them its 作品 (?list=, else the first). No title,
// and no covers, as the user asked: the corner menu's star says where this is. Both picks live in the URL, so coming
// back from a 作品 finds the same list.
export default function Favorites() {
  const t = useT()
  const fav = useFavorites()
  const [params, setParams] = useSearchParams()
  const folder = fav.folders.find((f) => f.id === params.get('list')) ?? fav.folders[0]
  const shows = [
    { key: 'all', label: t('全部', 'All'), empty: t('这个收藏夹还是空的。在作品页点「收藏」，把作品放进来。', 'This list is empty. Press Save on a title to add it.') },
    { key: 'unwatched', label: t('没看过', 'Not watched'), empty: t('都看过了。', 'All watched.') },
    { key: 'watched', label: t('看过', 'Watched'), empty: t('还没有看过的。', 'Nothing watched yet.') },
  ]
  const show = shows.find((s) => s.key === params.get('show')) ?? shows[0]
  const titles = (folder?.titles ?? []).filter(
    (m) => show.key === 'all' || isWatched(fav, m) === (show.key === 'watched'),
  )
  const from = { lineup: lineupOf(titles) }
  // Committed at once, not in the router's transition, which a quick press on the next one would throw away.
  const choose = (name: 'list' | 'show', value: string) =>
    setParams(
      (p) => {
        p.set(name, value)
        return p
      },
      { replace: true, preventScrollReset: true, flushSync: true },
    )
  // The 收藏夹 scroll sideways when they don't fit (a phone, or many), and start at the picked one when, back from a
  // 作品, it would sit past the edge or under scroll-hint's fade there. Sideways only, so the page keeps
  // the scroll it's given back; the row is `relative`, so a name's offsetLeft counts from it.
  // ponytail: no paging buttons, as home rows have: a mouse without a trackpad reaches 收藏夹 past the edge with shift
  // and the wheel. Give the row Row's if 收藏夹 ever run that many.
  const lists = useRef<HTMLDivElement>(null)
  const [start] = useState(() => (folder ? fav.folders.indexOf(folder) : 0))
  useLayoutEffect(() => {
    const el = lists.current!
    const picked = el.querySelectorAll('label')[start]
    const style = getComputedStyle(el)
    const fade = parseFloat(style.getPropertyValue('--scroll-hint-size'))
    if (picked && picked.offsetLeft + picked.offsetWidth > el.clientWidth - fade)
      el.scrollLeft = picked.offsetLeft - parseFloat(style.paddingLeft)
  }, [start])

  return (
    <Page title={t('收藏', 'Favorites')} hideTitle>
      {/* 全部 / 没看过 / 看过 go under the 收藏夹 when the line can't hold both, as on a phone */}
      <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-3">
        {/* room all round for a name's focus ring and the star's glow under it, which the scrolling box would clip */}
        {/* a div, not a fieldset, as browsers scroll a fieldset's content through a box of their own */}
        <div
          ref={lists}
          role="radiogroup"
          aria-label={t('收藏夹', 'Lists')}
          className="no-scrollbar scroll-hint relative -mx-3 -my-4 flex min-w-0 items-center gap-6 overflow-x-auto overscroll-x-contain px-3 py-4"
        >
          {fav.folders.map((f) => (
            <List
              key={f.id}
              f={f}
              seen={f.titles.filter((m) => isWatched(fav, m)).length}
              picked={f === folder}
              onPick={() => choose('list', f.id)}
            />
          ))}
          <NewFolder
            onAdd={(id) => {
              choose('list', id)
              // once the new one is drawn, as it pushes the field on
              requestAnimationFrame(() => lists.current?.scrollTo({ left: lists.current.scrollWidth }))
            }}
            // underlined while it's typed in, its only frame
            className="w-32 shrink-0 border-b border-transparent pb-0.5 focus-within:border-star/40"
          />
        </div>
        {folder && (
          <div className="flex items-center gap-4">
            <Choices legend={t('看过没有', 'Watched or not')} options={shows} value={show.key} onChange={(s) => choose('show', s)} />
            {/* a 收藏夹 removed, the first is the one shown, and the row goes back to it */}
            <FolderSettings key={folder.id} f={folder} onRemove={() => lists.current?.scrollTo({ left: 0 })} />
          </div>
        )}
      </div>
      {folder ? (
        titles.length ? (
          <div className={cn(posterGrid, 'mt-6')}>
            {titles.map((m) => (
              <Saved key={hrefOf(m)} m={m} watched={isWatched(fav, m)} from={from} />
            ))}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">{show.empty}</p>
        )
      ) : (
        <p className="mt-6 max-w-md text-body leading-7 text-muted-foreground">
          {t(
            '还没有收藏夹。在上面给它起个名字，或者在作品页点「收藏」新建一个。',
            'No lists yet. Name one above, or start one from Save on a title.',
          )}
        </p>
      )}
    </Page>
  )
}

// A 收藏夹 among them, a radio: its name, starred when picked, then how many it holds and how many of those are 看过.
// The star goes under the name alone, so the radio sits in the name's box, which shows its focus; a long name is cut
// short inside it, as cutting the box would clip the star. Pointing anywhere on it lights the name.
function List({ f, seen, picked, onPick }: { f: Folder; seen: number; picked: boolean; onPick: () => void }) {
  const t = useT()
  const n = f.titles.length
  return (
    <label className="group flex shrink-0 cursor-pointer items-baseline gap-1.5">
      <span className={cn(choice(picked), 'group-hover:text-foreground')}>
        <input type="radio" name="list" checked={picked} onChange={onPick} className="sr-only" />
        <span className="block max-w-[12em] truncate">{f.name}</span>
      </span>
      <span aria-hidden="true" className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
        {n}
        {seen > 0 && (
          <span className="flex items-center gap-0.5">
            <Played on className="size-3" />
            {seen}
          </span>
        )}
      </span>
      <span className="sr-only">{t(`，${n} 部，看过 ${seen} 部`, `, ${n} title${n === 1 ? '' : 's'}, ${seen} watched`)}</span>
    </label>
  )
}

// A saved 作品's poster, and 看过 at the end of its year's line, lit when it's been watched, which dims the poster till
// it's pointed at. The button sits beside the card's link, as a link can't hold one.
function Saved({ m, watched, from }: { m: Card; watched: boolean; from: From }) {
  const t = useT()
  return (
    <div className={cn('relative', watched && '[&>a]:opacity-45 [&>a]:transition-opacity hover:[&>a]:opacity-100')}>
      <PosterCard m={m} from={from} />
      <button
        type="button"
        aria-pressed={watched}
        aria-label={t(`看过 ${titleOf(m)}`, `Watched ${titleOf(m)}`)}
        onClick={() => toggleWatched(m)}
        className={cn(
          'absolute right-0 bottom-0 inline-flex items-center gap-1 rounded-sm text-xs transition-colors',
          watched ? 'text-star [&_svg]:drop-shadow-glow' : 'text-muted-foreground/60 hover:text-star',
        )}
      >
        <Played on={watched} className="size-3.5" />
        {t('看过', 'Watched')}
      </button>
    </div>
  )
}

// The sliders at the end of the row of filters, and the dialog they open: the picked 收藏夹's name, and 删除 on a
// second press within a few seconds, which leaves its 作品's 看过 as it was; `onRemove` runs once it's gone.
function FolderSettings({ f, onRemove }: { f: Folder; onRemove: () => void }) {
  const t = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  // 删除 asks once more, and forgets it was asked after a moment, or when the dialog closes, as a 服务器's 移除 does
  const [sure, setSure] = useState(false)
  const unsure = useRef<ReturnType<typeof setTimeout>>(undefined)
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        title={t('收藏夹设置', 'List settings')}
        className="rounded-md p-2 text-star/60 transition-colors hover:text-star"
      >
        <Constellation lines={sliders} />
      </button>
      <dialog
        ref={dialog}
        // what was typed goes with it, however it closes
        onClose={(e) => {
          setSure(false)
          clearTimeout(unsure.current)
          e.currentTarget.querySelector('form')?.reset()
        }}
        aria-label={t('收藏夹设置', 'List settings')}
        className={dialogBox}
      >
        {/* method=dialog: saving closes it */}
        <form
          method="dialog"
          onSubmit={(e) => {
            renameFolder(f.id, String(new FormData(e.currentTarget).get('name')).trim())
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {t('名字', 'Name')}
            {/* not spaces alone, which would leave it nameless */}
            <Input name="name" defaultValue={f.name} required pattern=".*\S.*" autoComplete="off" className="h-10" />
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => {
                if (!sure) {
                  setSure(true)
                  unsure.current = setTimeout(() => setSure(false), 3000)
                  return
                }
                dialog.current?.close()
                removeFolder(f.id)
                onRemove()
              }}
              className={cn('mr-auto text-muted-foreground hover:text-destructive', sure && 'text-destructive')}
            >
              {sure ? t('确认删除', 'Delete?') : t('删除', 'Delete')}
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={() => dialog.current?.close()}>
              {t('取消', 'Cancel')}
            </Button>
            <Button type="submit" size="lg">
              {t('保存', 'Save')}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
