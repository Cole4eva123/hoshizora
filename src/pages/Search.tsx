import { useState } from 'react'
import { Link } from 'react-router'
import { Globe, Layers, Server } from 'lucide-react'
import { EmptyState, Page } from '@/components/Page'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const toLibrary = (
  <Link to="/library" className="text-primary hover:underline">
    媒体库
  </Link>
)

// Each scope has its own colour (--tone) and icon; the search field takes on the selected one.
const scopes = [
  {
    key: 'all',
    label: '全部服务器',
    hint: '同时搜索所有已连接的服务器',
    icon: Layers,
    tone: '[--tone:var(--primary)]',
    placeholder: '在所有服务器里找作品',
    empty: { title: '还没有可搜索的服务器', body: <>先去{toLibrary}连接 Emby 服务器，这里会一次搜遍所有服务器。</> },
  },
  {
    key: 'tmdb',
    label: 'TMDB',
    hint: '查作品资料，不限于自己服务器上的',
    icon: Globe,
    tone: '[--tone:var(--tmdb)]',
    placeholder: '在 TMDB 查作品或演员',
    empty: { title: 'TMDB 的结果会列在这里', body: <>自己服务器上没有的作品，也能在这里查到资料。</> },
  },
  {
    key: 'server',
    label: '指定服务器',
    hint: '只在选中的一台服务器里搜索',
    icon: Server,
    tone: '[--tone:var(--apricot)]',
    placeholder: '在这台服务器里找作品',
    empty: { title: '还没有可选的服务器', body: <>先去{toLibrary}连接 Emby 服务器，再挑一台单独搜索。</> },
  },
]

export default function Search() {
  const [scope, setScope] = useState(scopes[0])
  const [query, setQuery] = useState('')

  return (
    <Page title="搜索">
      <div className={cn('max-w-3xl', scope.tone)}>
        <fieldset className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          <legend className="sr-only">搜索范围</legend>
          {scopes.map((s) => (
            <label
              key={s.key}
              className={cn(
                'flex cursor-pointer gap-3 rounded-2xl border bg-card/40 px-4 py-3 transition-colors hover:bg-card has-checked:border-tone has-checked:bg-tone/10 has-focus-visible:outline-2 has-focus-visible:outline-tone sm:py-4',
                s.tone,
              )}
            >
              <input
                type="radio"
                name="scope"
                checked={s === scope}
                onChange={() => setScope(s)}
                className="sr-only"
              />
              <s.icon className="mt-0.5 size-5 shrink-0 text-tone" />
              <span>
                <span className="block font-medium">{s.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{s.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="relative mt-6">
          <scope.icon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-tone" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={scope.placeholder}
            aria-label={scope.placeholder}
            className="h-12 rounded-xl pl-12 text-base caret-tone focus-visible:border-tone focus-visible:ring-tone/25 md:text-base"
          />
        </div>

        <div className="mt-12">
          <EmptyState icon={scope.icon} title={scope.empty.title}>
            {scope.empty.body}
          </EmptyState>
        </div>
      </div>
    </Page>
  )
}
