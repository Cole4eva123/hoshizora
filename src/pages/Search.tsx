import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { SearchIcon } from 'lucide-react'
import { PosterGrid } from '@/components/PosterRow'
import { searchPath } from '@/lib/tmdb'
import { cn } from '@/lib/utils'

const toLibrary = (
  <Link to="/library" className="text-primary hover:underline">
    媒体库
  </Link>
)

// Each 搜索范围 has its own colour (--tone): the picked one's star, and the field's icon, caret and ring.
const scopes = [
  {
    key: 'all',
    label: '全部服务器',
    tone: '[--tone:var(--primary)]',
    placeholder: '在所有服务器里找作品',
    empty: <>还没有可搜索的服务器。先去{toLibrary}连接 Emby 服务器，这里会一次搜遍所有服务器。</>,
  },
  { key: 'tmdb', label: 'TMDB', tone: '[--tone:var(--tmdb)]', placeholder: '在 TMDB 上找作品' },
  {
    key: 'server',
    label: '指定服务器',
    tone: '[--tone:var(--apricot)]',
    placeholder: '在这台服务器里找作品',
    empty: <>还没有可选的服务器。先去{toLibrary}连接 Emby 服务器，再挑一台单独搜索。</>,
  },
]

// The scope and the query live in the URL, so coming back from a title brings back the same results.
export default function Search() {
  const [params, setParams] = useSearchParams()
  // ponytail: TMDB is the default while no Emby server can be connected; make it 全部服务器 once one can
  const scope = scopes.find((s) => s.key === params.get('scope')) ?? scopes[1]
  const q = params.get('q') ?? ''

  // What's typed is searched once typing pauses, and Chinese once the IME commits it, not while it's still pinyin.
  const [typed, setTyped] = useState(q)
  useEffect(() => {
    const text = typed.trim()
    if (text === q) return
    const t = setTimeout(() => setParams({ scope: scope.key, q: text }, { replace: true }), 300)
    return () => clearTimeout(t)
  }, [typed, q, scope.key, setParams])

  return (
    // starts where other pages' titles do, clear of the corner menu
    <div className={cn('px-(--gutter) pt-[calc(var(--menu-top)+4.5rem)] pb-(--page-bottom)', scope.tone)}>
      <h1 className="sr-only">搜索</h1>
      {/* Enter, or the keyboard's 搜索 key, puts the keyboard away so the results show */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          ;(document.activeElement as HTMLElement).blur()
        }}
        className="mx-auto max-w-xl"
      >
        {/* Quiet words over the field: no box, nothing to compete with it. The picked one lights up over a star in
            its colour, like the current page in the corner menu. */}
        <fieldset className="mb-4 flex justify-center gap-7 text-sm">
          <legend className="sr-only">搜索范围</legend>
          {scopes.map((s) => (
            <label
              key={s.key}
              className={cn(
                'group relative cursor-pointer rounded-sm py-1 text-muted-foreground transition-colors hover:text-foreground has-checked:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-tone',
                s.tone,
              )}
            >
              <input
                type="radio"
                name="scope"
                checked={s === scope}
                onChange={() => setParams({ scope: s.key, q: typed.trim() }, { replace: true })}
                className="sr-only"
              />
              {s.label}
              <span className="absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-tone opacity-0 shadow-[0_0_6px_1px_var(--tone)] transition-opacity group-has-checked:opacity-100" />
            </label>
          ))}
        </fieldset>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-tone" />
          {/* what's typed is set like a title, in the headings' serif */}
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
            className="h-14 w-full rounded-2xl bg-card pr-5 pl-14 font-heading text-xl font-black caret-tone outline-none inset-ring inset-ring-star/15 transition-shadow placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-muted-foreground focus-visible:inset-ring-tone/60 md:text-2xl"
          />
        </div>
      </form>

      <div className="mt-12">
        {scope.empty ? (
          <p className="mx-auto max-w-sm text-center text-sm leading-6 text-balance text-muted-foreground">{scope.empty}</p>
        ) : (
          q && <PosterGrid path={searchPath(q)} />
        )}
      </div>
    </div>
  )
}
