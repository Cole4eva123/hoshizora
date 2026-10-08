import { useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { EmptyState, Page } from '@/components/Page'
import { Failed, Frame, PagedGrid, Poster, Row } from '@/components/PosterRow'
import { type Library, type Server, nameOf, useItems, useLibraries, useServers } from '@/lib/emby'
import { useT } from '@/lib/i18n'
import { hrefOf } from '@/lib/tmdb'
import { choice, cn, usePages } from '@/lib/utils'

// 11,392 in either language, whatever the browser's
const count = (n: number) => n.toLocaleString('en-US')

// A 服务器 opened from the 媒体库 page, by its id and its user's, as one server can be signed in as two users. One
// removed meanwhile, or another device's link, goes back to the 媒体库 page.
export default function ServerPage() {
  const { server, user } = useParams()
  const s = useServers().find((x) => x.id === server && x.userId === user)
  // keyed, so another server's page starts over rather than keep this one's state
  return s ? <Browse key={`${s.id}/${s.userId}`} server={s} /> : <Navigate to="/library" replace />
}

// The server's 媒体库 as its own covers, and under them the 作品 of the one picked (?lib=, else the first), newest
// added first. A card opens the 作品's page when the server knows its TMDB entry, and the 上一部/下一部 there step
// through the cards shown.
function Browse({ server }: { server: Server }) {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const { libraries, error, retry } = useLibraries(server)
  const library = libraries?.find((l) => l.id === params.get('lib')) ?? libraries?.[0]
  const { items, total, lineup, ...list } = useItems(server, library?.id, usePages())
  const from = lineup && { lineup }
  // The covers start at the one picked when the 媒体库 come in, which, back from a 作品 or opened from a link, may sit
  // past the screen's edge. Only then: a cover picked later is in view already.
  const [start, setStart] = useState<number>()
  if (libraries && library && start === undefined) setStart(libraries.indexOf(library))
  // another 媒体库 starts over at its first page
  const pick = (l: Library) =>
    setParams(
      (p) => {
        p.set('lib', l.id)
        p.delete('pages')
        return p
      },
      // the covers stay where they are, as arrow keys step through them
      { replace: true, preventScrollReset: true },
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
    <Page title={nameOf(server)} back>
      {/* the row runs to the screen's edges, past the page's gutter */}
      <div className="-mx-(--gutter)">
        <Row
          title={t('媒体库', 'Libraries')}
          start={start}
          track="auto-cols-[42%] sm:auto-cols-[calc((100%-2*1rem)/3)] lg:auto-cols-[calc((100%-3*1rem)/4)] xl:auto-cols-[calc((100%-4*1rem)/5)]"
        >
          {libraries
            ? libraries.map((l) => <Cover key={l.id} library={l} picked={l === library} onPick={() => pick(l)} />)
            : Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="aspect-video animate-pulse rounded-lg bg-muted/70" />
              ))}
        </Row>
      </div>
      <p className="mt-8 mb-5 h-5 text-sm text-muted-foreground">
        {total !== undefined && t(`共 ${count(total)} 部`, `${count(total)} title${total === 1 ? '' : 's'}`)}
      </p>
      <PagedGrid {...list} loading={!libraries || list.loading} count={items?.length}>
        {items?.map((i) => (
          <Poster key={i.id} to={i.tmdb && hrefOf(i.tmdb)} state={from} src={i.poster} title={i.name}>
            {i.year}
          </Poster>
        ))}
      </PagedGrid>
    </Page>
  )
}

// A 媒体库's cover, a radio among the server's: the picked one lights up, and its name is starred like a picked word
// in a Choices row; the others are dimmed until pointed at.
function Cover({ library, picked, onPick }: { library: Library; picked: boolean; onPick: () => void }) {
  return (
    <label className="group snap-start cursor-pointer">
      <input type="radio" name="library" checked={picked} onChange={onPick} className="sr-only" />
      <Frame
        src={library.cover}
        className={cn(
          'aspect-video transition duration-300 group-has-focus-visible:outline-2 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-ring',
          picked ? 'outline-star/70 shadow-[0_0_24px_-6px_var(--glow)]' : 'opacity-50 group-hover:opacity-100',
        )}
      />
      <span className={cn(choice(picked), 'mt-2 block w-fit group-hover:text-foreground')}>{library.name}</span>
    </label>
  )
}
