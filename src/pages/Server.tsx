import { useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { Choices } from '@/components/Choices'
import { ServerMark } from '@/components/Constellation'
import { EmptyState, Page } from '@/components/Page'
import { Failed, Frame, PagedGrid, Poster, Row, StillSkeletons } from '@/components/PosterRow'
import {
  type Library,
  type Server,
  librarySorts,
  nameOf,
  statusText,
  useItems,
  useLibraries,
  useServers,
  useStatus,
} from '@/lib/emby'
import { useT } from '@/lib/i18n'
import { hrefOf } from '@/lib/tmdb'
import { choice, cn, mostCols, usePages } from '@/lib/utils'

// 11,392 in either language, whatever the browser's
const count = (n: number) => n.toLocaleString('en-US')

// A 服务器 opened from the 媒体库 page, by its id and its user's, as one server can be signed in as two users. One
// removed meanwhile, or another device's link, goes back to the 媒体库 page.
// a 媒体库's cover, with the next one peeking in on a phone; then three to five to a row
const coverTrack = 'auto-cols-[42%] sm:auto-cols-(--span) sm:[--cols:3] lg:[--cols:4] xl:[--cols:5]'

export default function ServerPage() {
  const { server, user } = useParams()
  const s = useServers().find((x) => x.id === server && x.userId === user)
  // keyed, so another server's page starts over rather than keep this one's state
  return s ? <Browse key={`${s.id}/${s.userId}`} server={s} /> : <Navigate to="/library" replace />
}

// The server's 媒体库 as its own covers, and under them the 作品 of the one picked (?lib=, else the first), in the
// order picked (?sort=, else the newest added first). A card opens the 作品's page when the server knows its TMDB
// entry, and the 上一部/下一部 there step through the cards shown and on through the 媒体库.
function Browse({ server }: { server: Server }) {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const { libraries, error, retry } = useLibraries(server)
  const status = useStatus(server)
  const library = libraries?.find((l) => l.id === params.get('lib')) ?? libraries?.[0]
  const sorts = librarySorts(t, params.get('sort'))
  const sort = sorts.find((s) => s.key === params.get('sort')) ?? sorts[0]
  const pages = usePages()
  const { items, total, lineup, ...list } = useItems(server, library?.id, sort.key, pages)
  // a card carries its 媒体库 along with the lineup, so 下一部 past the last card loaded goes on into the next page
  const shelf = library && { server: server.id, user: server.userId, library: library.id, sort: sort.key, pages }
  const from = lineup && { lineup, list: shelf }
  // The covers start at the one picked when the 媒体库 come in, which, back from a 作品 or opened from a link, may sit
  // past the screen's edge. Only then: a cover picked later is in view already.
  const [start, setStart] = useState<number>()
  if (libraries && library && start === undefined) setStart(libraries.indexOf(library))
  // Another 媒体库 or another order starts over at its first page, and keeps the other. Committed at once, not in the
  // router's transition, which a quick press on the next one would throw away, so what's lit is always what's shown.
  const choose = (name: 'lib' | 'sort', value: string) =>
    setParams(
      (p) => {
        p.set(name, value)
        p.delete('pages')
        return p
      },
      // the covers stay where they are, as arrow keys step through them
      { replace: true, preventScrollReset: true, flushSync: true },
    )

  if (error)
    return (
      <Page title={nameOf(server)} back>
        <Failed error={error} retry={retry} />
      </Page>
    )
  if (libraries && !libraries.length)
    return (
      <Page title={nameOf(server)} back>
        <EmptyState title={t('这台服务器上没有电影或剧集', 'No movies or series on this server')}>
          {t(
            '放映室只放电影和剧集，音乐、照片之类的媒体库不会列在这里。',
            "Only movie and series libraries show here, as music, photos and the like can't be played.",
          )}
        </EmptyState>
      </Page>
    )

  return (
    <Page title={nameOf(server)} back hideTitle>
      {/* the row runs to the screen's edges, past the page's gutter */}
      <div className="-mx-(--gutter)">
        <Row
          // the server's name, small, over its covers, rather than as the page's large title; its mark and light
          // before it, as on its tile, so the page reads as the tile opened
          title={
            <span className="inline-flex items-center gap-2">
              <ServerMark status={status} className="size-[1.7em]" />
              {nameOf(server)}
            </span>
          }
          // the light in words, for screen readers, outside the heading so it isn't read as part of the name
          extra={
            <p role="status" className="sr-only">
              {statusText(status, t)}
            </p>
          }
          start={start}
          track={coverTrack}
        >
          {libraries
            ? libraries.map((l) => <Cover key={l.id} library={l} picked={l === library} onPick={() => choose('lib', l.id)} />)
            : <StillSkeletons n={mostCols(coverTrack)} />}
        </Row>
      </div>
      <div className="my-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <Choices legend={t('排序', 'Sort by')} options={sorts} value={sort.key} onChange={(s) => choose('sort', s)} />
          <p className="text-sm text-muted-foreground">
            {total !== undefined && t(`共 ${count(total)} 部`, `${count(total)} title${total === 1 ? '' : 's'}`)}
          </p>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{sort.hint}</p>
      </div>
      <PagedGrid {...list} loading={!libraries || list.loading} count={items?.length}>
        {items?.map((i) => (
          <Poster
            key={i.id}
            to={i.tmdb && hrefOf(i.tmdb)}
            state={from && { ...from, item: i.id }}
            src={i.poster}
            title={i.name}
          >
            {i.year}
          </Poster>
        ))}
      </PagedGrid>
    </Page>
  )
}

// A 媒体库's cover, a radio among the server's: the picked one lights up at once, as the 作品 under it change at once,
// and its name is starred like a picked word in a Choices row; the others are dimmed until pointed at.
function Cover({ library, picked, onPick }: { library: Library; picked: boolean; onPick: () => void }) {
  return (
    <label className="group snap-start cursor-pointer">
      <input type="radio" name="library" checked={picked} onChange={onPick} className="sr-only" />
      <Frame
        src={library.cover}
        className={cn(
          'aspect-video transition-opacity group-has-focus-visible:outline-2 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-ring',
          // the glow of the picked one among pictures that are radios
          picked ? 'shadow-lit outline-star/70' : 'opacity-50 group-hover:opacity-100',
        )}
      />
      <span className={cn(choice(picked), 'mt-2 block w-fit group-hover:text-foreground')}>{library.name}</span>
    </label>
  )
}
