import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Choices } from '@/components/Choices'
import { Constellation, type Star } from '@/components/Constellation'
import { NewFolder } from '@/components/Favorite'
import { Page } from '@/components/Page'
import { PosterCard, Row, coverRow, posterGrid } from '@/components/PosterRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type Folder, isWatched, removeFolder, renameFolder, toggleWatched, useFavorites } from '@/lib/favorites'
import { useT } from '@/lib/i18n'
import { type Card, type From, hrefOf, img, lineupOf, titleOf } from '@/lib/tmdb'
import { choice, cn, dialogBox, lit, reveal, sliders } from '@/lib/utils'

// 看过: a tick drawn as three stars.
const tick: Star[][] = [[[4, 12.5], [9.5, 18], [20, 6]]]

// The 收藏夹 as covers in a row, as a 服务器's 媒体库 are, the last one a field for a new one; under them the 作品 of
// the one picked (?list=, else the first), all of them, those not 看过 or those 看过 (?show=). No title over it: the
// corner menu's star says where this is. Both picks live in the URL, so coming back from a 作品 finds the same list.
export default function Favorites() {
  const t = useT()
  const fav = useFavorites()
  const [params, setParams] = useSearchParams()
  const folder = fav.folders.find((f) => f.id === params.get('list')) ?? fav.folders[0]
  // The covers start at the picked one, which, back from a 作品, may sit past the screen's edge; and at a new one, made
  // at the row's end. Only then: a cover picked meanwhile is in view already.
  const [start, setStart] = useState(() => (folder ? fav.folders.indexOf(folder) : undefined))
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

  return (
    <Page title={t('收藏', 'Favorites')} hideTitle>
      {/* the row runs to the screen's edges, past the page's gutter */}
      <div className="-mx-(--gutter)">
        <Row track={coverRow} start={start}>
          {fav.folders.map((f) => (
            <Cover
              key={f.id}
              f={f}
              seen={f.titles.filter((m) => isWatched(fav, m)).length}
              picked={f === folder}
              onPick={() => choose('list', f.id)}
            />
          ))}
          <div className="grid aspect-video snap-start place-items-center rounded-lg border border-dashed border-star/25 transition-colors focus-within:border-star/60 hover:border-star/60">
            <NewFolder
              onAdd={(id) => {
                setStart(fav.folders.length)
                choose('list', id)
              }}
              className="w-3/4"
            />
          </div>
        </Row>
      </div>
      {folder ? (
        <>
          <div className="my-8 flex items-center justify-between gap-6">
            <Choices legend={t('看过没有', 'Watched or not')} options={shows} value={show.key} onChange={(s) => choose('show', s)} />
            {/* a 收藏夹 removed, the first is the one shown, and the covers go back to it */}
            <FolderSettings key={folder.id} f={folder} onRemove={() => setStart(0)} />
          </div>
          {titles.length ? (
            <div className={posterGrid}>
              {titles.map((m) => (
                <Saved key={hrefOf(m)} m={m} watched={isWatched(fav, m)} from={from} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{show.empty}</p>
          )}
        </>
      ) : (
        <p className="mt-8 max-w-md text-[15px] leading-7 text-muted-foreground">
          {t(
            '还没有收藏夹。在上面给它起个名字，或者在作品页点「收藏」新建一个。',
            'No lists yet. Name one above, or start one from Save on a title.',
          )}
        </p>
      )}
    </Page>
  )
}

// A 收藏夹's cover, a radio among them: its latest three posters side by side, its name starred when picked, and how
// many it holds and how many of those are 看过. The others are dimmed until pointed at.
function Cover({ f, seen, picked, onPick }: { f: Folder; seen: number; picked: boolean; onPick: () => void }) {
  const t = useT()
  const n = f.titles.length
  return (
    <label className="group snap-start cursor-pointer">
      <input type="radio" name="list" checked={picked} onChange={onPick} className="sr-only" />
      <div
        className={cn(
          'grid aspect-video grid-cols-3 overflow-hidden rounded-lg bg-muted outline -outline-offset-1 outline-white/8 transition-opacity group-has-focus-visible:outline-2 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-ring',
          picked ? cn('outline-star/70', lit) : 'opacity-50 group-hover:opacity-100',
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
      </div>
      <span className={cn(choice(picked), 'mt-2 block w-fit group-hover:text-foreground')}>{f.name}</span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {t(`${n} 部，看过 ${seen} 部`, `${n} title${n === 1 ? '' : 's'}, ${seen} watched`)}
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
        <Constellation lines={tick} className="size-3.5" />
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
