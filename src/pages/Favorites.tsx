import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Choices } from '@/components/Choices'
import { Constellation, Filled } from '@/components/Constellation'
import { NewFolder } from '@/components/Favorite'
import { Page } from '@/components/Page'
import { PosterCard, posterGrid, posterRow } from '@/components/PosterRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type Folder, isWatched, removeFolder, renameFolder, toggleWatched, useFavorites } from '@/lib/favorites'
import { useT } from '@/lib/i18n'
import { type Card, type From, hrefOf, img, lineupOf, titleOf } from '@/lib/tmdb'
import { choice, cn, dialogBox, lit, play, reveal, sliders } from '@/lib/utils'

// 看过: the logo's play triangle, filled with light once the 作品 has been watched.
const Played = ({ on, className }: { on: boolean; className: string }) =>
  on ? <Filled line={play[0]} className={className} /> : <Constellation lines={play} className={className} />

// The 收藏夹 as a shelf of covers, each one column of the poster grid wide, its name and count on one line above it,
// the last a field for a new one; under them the 作品 of the one picked (?list=, else the first), all of them, those
// not 看过 or those 看过 (?show=). No title over it: the corner menu's star says where this is. Both picks live in the
// URL, so coming back from a 作品 finds the same list.
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
  // The shelf starts at the picked cover, which, back from a 作品, may sit past the screen's edge. Sideways only, so
  // the page keeps the scroll it's given back; the shelf is `relative`, so a cover's offsetLeft counts from it.
  // ponytail: no paging buttons, as home rows have: once the 收藏夹 and the field after them outrun the screen (three
  // columns on a phone, six on a wide one), a mouse without a trackpad scrolls with shift and the wheel. Give the shelf
  // Row's if that ever bites.
  const shelf = useRef<HTMLDivElement>(null)
  const field = useId()
  const [start] = useState(() => (folder ? fav.folders.indexOf(folder) : 0))
  useLayoutEffect(() => {
    const el = shelf.current!
    const cover = el.children[start] as HTMLElement
    el.scrollLeft = cover.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft)
  }, [start])

  return (
    <Page title={t('收藏', 'Favorites')} hideTitle>
      {/* it runs to the screen's edges, past the page's gutter, its columns the grid's under it; room under it for the
          picked cover's glow, which the scrolling box would clip */}
      <div
        ref={shelf}
        className={cn(
          'no-scrollbar relative -mx-(--gutter) grid snap-x snap-mandatory scroll-px-(--gutter) grid-flow-col gap-3 overflow-x-auto overscroll-x-contain px-(--gutter) pt-1 pb-5 sm:gap-4',
          posterRow,
        )}
      >
        {fav.folders.map((f) => (
          <Cover
            key={f.id}
            f={f}
            seen={f.titles.filter((m) => isWatched(fav, m)).length}
            picked={f === folder}
            onPick={() => choose('list', f.id)}
          />
        ))}
        {/* the field where a name would be, and where the cover would be a dashed frame that's its label, lit while it's
            typed in; a new 收藏夹 pushes the field on, so the shelf follows it to the end */}
        <div className="group snap-start">
          <NewFolder
            id={field}
            onAdd={(id) => {
              choose('list', id)
              // once the new cover is drawn
              requestAnimationFrame(() => shelf.current?.scrollTo({ left: shelf.current.scrollWidth }))
            }}
            className="mb-2.5 h-5"
          />
          <label
            htmlFor={field}
            aria-hidden="true"
            className="block aspect-2/1 cursor-text rounded-lg border border-dashed border-star/20 transition-colors group-focus-within:border-star/60 group-hover:border-star/40"
          />
        </div>
      </div>
      {folder ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-6">
            <Choices legend={t('看过没有', 'Watched or not')} options={shows} value={show.key} onChange={(s) => choose('show', s)} />
            {/* a 收藏夹 removed, the first is the one shown, and the shelf goes back to it */}
            <FolderSettings key={folder.id} f={folder} onRemove={() => shelf.current?.scrollTo({ left: 0 })} />
          </div>
          {titles.length ? (
            <div className={cn(posterGrid, 'mt-5')}>
              {titles.map((m) => (
                <Saved key={hrefOf(m)} m={m} watched={isWatched(fav, m)} from={from} />
              ))}
            </div>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">{show.empty}</p>
          )}
        </>
      ) : (
        <p className="mt-2 max-w-md text-[15px] leading-7 text-muted-foreground">
          {t(
            '还没有收藏夹。在上面给它起个名字，或者在作品页点「收藏」新建一个。',
            'No lists yet. Name one above, or start one from Save on a title.',
          )}
        </p>
      )}
    </Page>
  )
}

// A 收藏夹's cover, a radio among them: over a strip of its latest three posters, on one line, its name, starred when
// picked, how many it holds and how many of those are 看过. The others are dimmed until pointed at.
function Cover({ f, seen, picked, onPick }: { f: Folder; seen: number; picked: boolean; onPick: () => void }) {
  const t = useT()
  const n = f.titles.length
  return (
    <label className="group min-w-0 snap-start cursor-pointer">
      <input type="radio" name="list" checked={picked} onChange={onPick} className="sr-only" />
      <span className="mb-2.5 flex items-baseline gap-1.5">
        {/* the star goes on the name's own box, as the name's truncation would clip it */}
        <span className={cn(choice(picked), 'min-w-0 py-0 text-[13px] leading-5 group-hover:text-foreground sm:text-sm')}>
          <span className="block truncate">{f.name}</span>
        </span>
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
          {n}
          {seen > 0 && (
            <span className="flex items-center gap-0.5">
              <Played on className="size-3" />
              {seen}
            </span>
          )}
        </span>
        <span className="sr-only">{t(`，${n} 部，看过 ${seen} 部`, `, ${n} title${n === 1 ? '' : 's'}, ${seen} watched`)}</span>
      </span>
      <span
        className={cn(
          'grid aspect-2/1 grid-cols-3 overflow-hidden rounded-lg bg-muted outline -outline-offset-1 outline-white/8 transition-opacity group-has-focus-visible:outline-2 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-ring',
          picked ? cn('outline-star/70', lit) : 'opacity-55 group-hover:opacity-100',
        )}
      >
        {f.titles
          .filter((m) => m.poster_path)
          .slice(0, 3)
          .map((m) => (
            <img
              key={hrefOf(m)}
              src={img(m.poster_path, 'w342')}
              alt=""
              loading="lazy"
              decoding="async"
              ref={reveal}
              onLoad={(e) => reveal(e.currentTarget)}
              className="size-full object-cover opacity-0 transition-opacity duration-500 data-loaded:opacity-100"
            />
          ))}
      </span>
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
          watched ? 'text-star [&_svg]:drop-shadow-[0_0_5px_var(--glow)]' : 'text-muted-foreground/60 hover:text-star',
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
