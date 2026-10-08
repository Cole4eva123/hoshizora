import { type ComponentProps, type RefObject, type SubmitEvent, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { ServerMark } from '@/components/Constellation'
import { EmptyState, Page } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  type Server,
  type Status,
  addServer,
  dismiss,
  nameOf,
  refresh,
  removeServer,
  statusText,
  useAdding,
  useServers,
  useStatus,
} from '@/lib/emby'
import { useT } from '@/lib/i18n'
import { cn, toneOf } from '@/lib/utils'

// The servers and the tile that adds one, as many to a row as fit: two on a phone.
const tile = 'min-h-44 rounded-2xl p-5'

export default function Library() {
  const t = useT()
  const servers = useServers()
  const adding = useAdding()
  const empty = !servers.length && !adding.length
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <Page title={t('媒体库', 'Library')}>
      {empty && (
        <EmptyState title={t('还没有连接 Emby 服务器', 'No Emby server connected')}>
          {t(
            '服务器和它们的媒体库会列在这里。添加地址并登录后，首页、收藏和搜索都会用到里面的作品。',
            'Your servers and their libraries are listed here. Once you add one and sign in, Home, Favorites and Search draw on its titles.',
          )}
        </EmptyState>
      )}
      <ul
        className={cn(
          'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]',
          empty && 'mt-8',
        )}
      >
        {servers.map((s) => (
          <ServerTile key={`${s.id}/${s.userId}`} server={s} />
        ))}
        {adding.map((a) => (
          // one under way can't be stopped
          <Tile key={a.id} {...a} adding onRemove={a.status === 'checking' ? undefined : () => dismiss(a)} />
        ))}
        <li>
          <button
            onClick={() => dialog.current?.showModal()}
            className={cn(
              tile,
              'flex size-full flex-col items-center justify-center gap-3 border border-dashed border-star/25 text-sm text-star/70 transition-colors hover:border-star/60 hover:text-star',
            )}
          >
            <Plus className="size-7" strokeWidth={1.5} />
            {t('添加服务器', 'Add server')}
          </button>
        </li>
      </ul>
      <AddServer dialog={dialog} />
    </Page>
  )
}

// A kept server, as it answers now. It opens its 媒体库; 移除 signs it out.
function ServerTile({ server }: { server: Server }) {
  const status = useStatus(server)
  return (
    <Tile
      {...server}
      name={nameOf(server)}
      status={status}
      to={`/library/${server.id}/${server.userId}`}
      onOpen={() => refresh(server)}
      onRemove={() => removeServer(server)}
    />
  )
}

// A server's light is its icon's own star: green when connected, red when not, grey while it's being asked. The word
// under the name says the same for anyone who can't tell red from green, and for screen readers. An add's tile
// (`adding`) is read out as it changes, as it may fail after the dialog has closed, and goes in one press, having
// nothing to sign out of. A tile with somewhere to go (`to`) is a link all over, but for its 移除, and `onOpen` runs as
// it's followed.
function Tile({
  name,
  userName,
  address,
  status,
  adding,
  to,
  onOpen,
  onRemove,
}: {
  name: string
  userName: string
  address: string
  status: Status
  adding?: boolean
  to?: string
  onOpen?: () => void
  onRemove?: () => void
}) {
  const t = useT()
  // 移除 asks once more, and forgets it was asked after a moment
  const [sure, setSure] = useState(false)
  return (
    <li
      className={cn(
        tile,
        'group relative bg-card inset-ring inset-ring-star/15',
        toneOf(status),
        // the link's focus, not 移除's, which shows its own
        to &&
          'transition-shadow hover:inset-ring-star/40 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring',
      )}
    >
      <ServerMark status={status} className="size-12" />
      <h2 className="mt-4 truncate font-heading text-lg font-black">
        {to ? (
          // its box is the tile's, so the whole tile takes the click; the tile shows the focus
          <Link to={to} onClick={onOpen} viewTransition className="outline-none after:absolute after:inset-0 after:rounded-2xl">
            {name}
          </Link>
        ) : (
          name
        )}
      </h2>
      <p role={adding ? 'status' : undefined} className="mt-1 text-sm text-tone">
        {statusText(status, t)}
      </p>
      <p className="mt-1 flex gap-x-2 text-xs text-muted-foreground">
        <span className="shrink-0">{userName}</span>
        <span className="truncate">{new URL(address).host}</span>
      </p>
      {onRemove && (
        <button
          onClick={() => {
            if (sure || adding) return onRemove()
            setSure(true)
            setTimeout(() => setSure(false), 3000)
          }}
          className="absolute top-3 right-3 rounded-sm px-1.5 py-1 text-xs text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          {sure ? t('确认移除', 'Remove?') : t('移除', 'Remove')}
        </button>
      )}
    </li>
  )
}

// Adding a server: where it is, the user to sign in as (an Emby user may have no password), and a 备注 to call it by if
// its own name won't do. The dialog closes at once, and the add goes on in its tile; only text that isn't an address is
// caught here, under its field.
function AddServer({ dialog }: { dialog: RefObject<HTMLDialogElement | null> }) {
  const t = useT()
  const [invalid, setInvalid] = useState(false)
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const field = (name: string) => String(data.get(name))
    try {
      addServer(field('address'), field('username'), field('password'), field('nickname'))
    } catch (err) {
      if (!(err instanceof TypeError)) throw err
      return setInvalid(true)
    }
    dialog.current?.close()
  }
  return (
    <dialog
      ref={dialog}
      // what was typed goes with it, the password included, however it closes
      onClose={(e) => {
        setInvalid(false)
        e.currentTarget.querySelector('form')?.reset()
      }}
      aria-label={t('添加服务器', 'Add server')}
      // Tailwind zeroes every margin, the dialog's centring included
      className="m-auto w-[min(26rem,calc(100vw-2*var(--gutter)))] rounded-2xl bg-card p-6 text-foreground inset-ring inset-ring-star/15 backdrop:bg-night/70 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label={t('地址', 'Address')}
          error={invalid ? t('这不是一个服务器地址。', "That isn't a server address.") : undefined}
          name="address"
          required
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="192.168.1.5:8096"
        />
        <Field label={t('用户名', 'Username')} name="username" required autoCapitalize="off" autoComplete="username" />
        <Field
          label={t('密码', 'Password')}
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder={t('没有密码就留空', 'Leave empty if there is none')}
        />
        <Field
          label={t('备注（可选）', 'Nickname (optional)')}
          name="nickname"
          autoComplete="off"
          placeholder={t('不填就用服务器自己的名字', "Leave empty to use the server's own name")}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="lg" onClick={() => dialog.current?.close()}>
            {t('取消', 'Cancel')}
          </Button>
          <Button type="submit" size="lg">
            {t('添加', 'Add')}
          </Button>
        </div>
      </form>
    </dialog>
  )
}

// A labelled input, and what went wrong with it under it: read out as it appears, and as the input's description rather
// than part of its name.
function Field({ label, error, ...input }: { label: string; error?: string } & ComponentProps<'input'>) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
      <label className="flex flex-col gap-1.5">
        {label}
        <Input {...input} aria-invalid={Boolean(error)} aria-describedby={error && id} className="h-10" />
      </label>
      {error && (
        <span id={id} role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
