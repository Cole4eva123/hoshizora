import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SearchIcon } from 'lucide-react'
import { Choices } from '@/components/Choices'
import { ToLibrary } from '@/components/Page'
import { PosterGrid } from '@/components/PosterRow'
import { type Translate, useT } from '@/lib/i18n'
import { searchPath } from '@/lib/tmdb'
import { cn } from '@/lib/utils'

// Each 搜索范围 has its own colour (--tone): its star when picked, and the field's icon, caret and ring.
const scopesIn = (t: Translate) => [
  {
    key: 'all',
    label: t('全部服务器', 'All servers'),
    tone: '[--tone:var(--primary)]',
    placeholder: t('在所有服务器里找作品', 'Search all your servers'),
    empty: t(
      <>还没有可搜索的服务器。先去<ToLibrary />连接 Emby 服务器，这里会一次搜遍所有服务器。</>,
      <>No servers to search yet. Connect an Emby server in <ToLibrary />, and this searches all of them at once.</>,
    ),
  },
  { key: 'tmdb', label: 'TMDB', tone: '[--tone:var(--tmdb)]', placeholder: t('在 TMDB 上找作品', 'Search TMDB') },
  {
    key: 'server',
    label: t('指定服务器', 'One server'),
    tone: '[--tone:var(--apricot)]',
    placeholder: t('在这台服务器里找作品', 'Search this server'),
    empty: t(
      <>还没有可选的服务器。先去<ToLibrary />连接 Emby 服务器，再挑一台单独搜索。</>,
      <>No servers to pick yet. Connect an Emby server in <ToLibrary />, then pick one to search.</>,
    ),
  },
]

// The scope and the query live in the URL, so coming back from a title brings back the same results.
export default function Search() {
  const t = useT()
  const scopes = scopesIn(t)
  const [params, setParams] = useSearchParams()
  // ponytail: TMDB is the default while no Emby server can be connected; make it 全部服务器 once one can
  const scope = scopes.find((s) => s.key === params.get('scope')) ?? scopes[1]
  const q = params.get('q') ?? ''

  // What's typed is searched once typing pauses, and Chinese once the IME commits it, not while it's still pinyin.
  const [typed, setTyped] = useState(q)
  useEffect(() => {
    const text = typed.trim()
    if (text === q) return
    const timer = setTimeout(() => setParams({ scope: scope.key, q: text }, { replace: true }), 300)
    return () => clearTimeout(timer)
  }, [typed, q, scope.key, setParams])

  return (
    // starts where other pages' titles do, clear of the corner menu
    <div className={cn('px-(--gutter) pt-(--page-top) pb-(--page-bottom)', scope.tone)}>
      <h1 className="sr-only">{t('搜索', 'Search')}</h1>
      {/* Enter, or the keyboard's 搜索 key, puts the keyboard away so the results show */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          ;(document.activeElement as HTMLElement).blur()
        }}
        className="mx-auto max-w-xl"
      >
        {/* Quiet words over the field, nothing to compete with it; the picked one's star takes the scope's colour */}
        <Choices
          legend={t('搜索范围', 'Search in')}
          options={scopes}
          value={scope.key}
          onChange={(key) => setParams({ scope: key, q: typed.trim() }, { replace: true })}
          className="mb-5 justify-center"
        />
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-tone" />
          {/* what's typed is set like a title, in the headings' serif. While the placeholder shows, the field takes its
              smaller sans, else the placeholder would sit on the serif's baseline, below the middle */}
          <input
            type="search"
            defaultValue={q}
            autoFocus={!q}
            onChange={(e) => {
              if (!(e.nativeEvent as InputEvent).isComposing) setTyped(e.target.value)
            }}
            onCompositionEnd={(e) => setTyped(e.currentTarget.value)}
            placeholder={scope.placeholder}
            aria-label={scope.placeholder}
            className="h-14 w-full rounded-2xl bg-card pr-5 pl-14 font-heading text-xl font-black caret-tone outline-none inset-ring inset-ring-star/15 transition-shadow placeholder-shown:font-sans placeholder-shown:text-base placeholder-shown:font-normal placeholder:text-muted-foreground focus-visible:inset-ring-tone/60 md:text-2xl"
          />
        </div>
      </form>

      {/* a scope's note sits close under the field, as part of it; results keep their distance */}
      <div className={scope.empty ? 'mt-5' : 'mt-12'}>
        {scope.empty ? (
          <p className="mx-auto max-w-sm text-center text-sm leading-6 text-balance text-muted-foreground">{scope.empty}</p>
        ) : (
          q && <PosterGrid path={searchPath(q)} />
        )}
      </div>
    </div>
  )
}
