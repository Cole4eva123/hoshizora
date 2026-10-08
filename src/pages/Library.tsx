import { type ComponentProps, type RefObject, type SubmitEvent, useId, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Constellation } from '@/components/Constellation'
import { EmptyState, Page } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AddError, type Server, addServer, nameOf, removeServer, useServers, useStatus } from '@/lib/emby'
import { useT } from '@/lib/i18n'
import { cn, server as serverIcon } from '@/lib/utils'

// The servers and the tile that adds one, as many to a row as fit: two on a phone.
const tile = 'min-h-44 rounded-2xl p-5'

export default function Library() {
  const t = useT()
  const servers = useServers()
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <Page title={t('媒体库', 'Library')}>
      {!servers.length && (
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
          !servers.length && 'mt-8',
        )}
      >
        {servers.map((s) => (
          <ServerTile key={`${s.id}/${s.userId}`} server={s} />
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

// A server's light is its icon's own star: green when connected, red when not, plain starlight while it's being asked.
// The word under the name says the same for anyone who can't tell red from green, and for screen readers.
function ServerTile({ server }: { server: Server }) {
  const t = useT()
  const status = useStatus(server)
  // 移除 asks once more, and forgets it was asked after a moment
  const [sure, setSure] = useState(false)
  const word = {
    checking: t('正在连接', 'Connecting'),
    online: t('已连接', 'Connected'),
    offline: t('连不上', 'Unreachable'),
    signedOut: t('登录已失效', 'Signed out'),
  }[status]
  return (
    <li
      className={cn(
        tile,
        'group relative bg-card inset-ring inset-ring-star/15',
        status === 'online' ? '[--tone:var(--online)]' : '[--tone:var(--destructive)]',
      )}
    >
      <div className="relative size-12 text-star/70">
        <Constellation lines={serverIcon} className="size-full" />
        {/* over the icon's light, at (7, 12) of its 24 */}
        <span
          className={cn(
            'absolute top-1/2 left-[29.17%] size-2 -translate-1/2 rounded-full bg-tone shadow-[0_0_8px_2px_var(--tone)] transition-opacity duration-500',
            status === 'checking' && 'opacity-0',
          )}
        />
      </div>
      <h2 className="mt-4 truncate font-heading text-lg font-black">{nameOf(server)}</h2>
      <p className={cn('mt-1 text-sm', status === 'checking' ? 'text-muted-foreground' : 'text-tone')}>{word}</p>
      <p className="mt-1 flex gap-x-2 text-xs text-muted-foreground">
        <span className="shrink-0">{server.userName}</span>
        <span className="truncate">{new URL(server.address).host}</span>
      </p>
      <button
        onClick={() => {
          if (sure) return removeServer(server)
          setSure(true)
          setTimeout(() => setSure(false), 3000)
        }}
        className="absolute top-3 right-3 rounded-sm px-1.5 py-1 text-xs text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
      >
        {sure ? t('确认移除', 'Remove?') : t('移除', 'Remove')}
      </button>
    </li>
  )
}

// Adding a server: where it is, the user to sign in as (an Emby user may have no password), and a 备注 to call it by if
// its own name won't do. What went wrong shows under the field it's about.
function AddServer({ dialog }: { dialog: RefObject<HTMLDialogElement | null> }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<AddError['reason']>()
  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    setBusy(true)
    setFailed(undefined)
    try {
      const field = (name: string) => String(data.get(name))
      await addServer(field('address'), field('username'), field('password'), field('nickname'))
      dialog.current?.close()
    } catch (err) {
      if (!(err instanceof AddError)) throw err
      // closed meanwhile, as Chrome lets a second Esc through: it opens clean next time
      if (dialog.current?.open) setFailed(err.reason)
    } finally {
      setBusy(false)
    }
  }
  const addressError =
    failed === 'unreachable'
      ? t('连不上这个地址。看看地址和端口对不对，Emby 默认用 8096。', "Can't reach this address. Check the address and port; Emby uses 8096 by default.")
      : failed === 'insecure'
        ? t('网页版只能连 https 地址的服务器。', 'The web version can only reach servers over https.')
        : undefined
  const signInError = failed === 'signIn' ? t('登录没成功。看看用户名和密码对不对。', "Couldn't sign in. Check the username and password.") : undefined
  return (
    <dialog
      ref={dialog}
      // what was typed goes with it, the password included
      onClose={(e) => {
        setFailed(undefined)
        e.currentTarget.querySelector('form')?.reset()
      }}
      // an add under way finishes in the open dialog, to show how it went (its requests time out)
      onCancel={(e) => busy && e.preventDefault()}
      aria-label={t('添加服务器', 'Add server')}
      // Tailwind zeroes every margin, the dialog's centring included
      className="m-auto w-[min(26rem,calc(100vw-2*var(--gutter)))] rounded-2xl bg-card p-6 text-foreground inset-ring inset-ring-star/15 backdrop:bg-night/70 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label={t('地址', 'Address')}
          error={addressError}
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
          error={signInError}
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
          <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={() => dialog.current?.close()}>
            {t('取消', 'Cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? t('正在连接…', 'Connecting…') : t('添加', 'Add')}
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
