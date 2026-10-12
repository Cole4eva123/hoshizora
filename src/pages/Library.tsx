import { type ComponentProps, type ReactNode, type RefObject, type SubmitEvent, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { Constellation, ServerMark } from '@/components/Constellation'
import { EmptyState, Page } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  type Adding,
  type EmbyError,
  type Form,
  type Server,
  type Status,
  addServer,
  canConnect,
  dismiss,
  editServer,
  errorText,
  nameOf,
  refresh,
  removeServer,
  statusText,
  useAdding,
  useServers,
  useStatus,
} from '@/lib/emby'
import { useT } from '@/lib/i18n'
import { cn, confirmFor, dialogBox, serverHref, sliders, toneOf } from '@/lib/utils'

// The servers and the tile that adds one, as many to a row as fit: two on a phone.
const tile = 'min-h-44 rounded-2xl p-5'

export default function Library() {
  const t = useT()
  const servers = useServers()
  const adding = useAdding()
  const empty = !servers.length && !adding.length
  const dialog = useRef<HTMLDialogElement>(null)
  // the web version has no Rust side to reach a server through
  if (!canConnect)
    return (
      <Page title={t('媒体库', 'Library')}>
        <EmptyState title={t('连接服务器要用放映室 App', 'Servers connect in the Hoshizora app')}>
          {t(
            '网页版只用来发现作品。在 Mac App 里添加 Emby 服务器，就能在 App 的媒体库里浏览它们的作品。',
            'The web version is for discovering titles. Add your Emby servers in the Mac app to browse their libraries there.',
          )}
        </EmptyState>
      </Page>
    )
  return (
    <Page title={t('媒体库', 'Library')}>
      {empty && (
        <EmptyState title={t('还没有连接 Emby 服务器', 'No Emby server connected')}>
          {t(
            '服务器和它们的媒体库会列在这里。添加地址并登录后，首页和搜索都会用到里面的作品。',
            'Your servers and their libraries are listed here. Once you add one and sign in, Home and Search draw on its titles.',
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
          // one under way can't be stopped or changed
          <Tile key={a.id} {...a} adding>
            {a.status !== 'checking' && <Settings adding={a} />}
          </Tile>
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
      <ServerDialog dialog={dialog} />
    </Page>
  )
}

// A kept server, as it answers now. It opens its 媒体库; the sliders in its corner open its settings.
function ServerTile({ server }: { server: Server }) {
  const status = useStatus(server)
  return (
    <Tile
      {...server}
      name={nameOf(server)}
      status={status}
      to={serverHref(server)}
      onOpen={() => refresh(server)}
    >
      <Settings server={server} />
    </Tile>
  )
}

// The sliders in a tile's top-right corner, and the dialog they open: a kept server's settings, or a failed add's, to
// try it again from what was typed.
function Settings({ server, adding }: { server?: Server; adding?: Adding }) {
  const t = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button
        onClick={() => dialog.current?.showModal()}
        title={server ? t('服务器设置', 'Server settings') : t('修改后重试', 'Edit and try again')}
        className="absolute top-3 right-3 rounded-md p-2 text-star/60 transition-colors hover:text-star focus-visible:text-star"
      >
        <Constellation lines={sliders} />
      </button>
      <ServerDialog dialog={dialog} server={server} adding={adding} />
    </>
  )
}

// A server's light is its icon's own star: green when connected, red when not, grey while it's being asked. The word
// under the name says the same for anyone who can't tell red from green, and for screen readers. An add's tile
// (`adding`) is read out as it changes, as it may fail after the dialog has closed. A tile with somewhere to go (`to`)
// is a link all over, but for what's in its corner (`children`), and `onOpen` runs as it's followed.
function Tile({
  name,
  userName,
  address,
  status,
  adding,
  to,
  onOpen,
  children,
}: {
  name: string
  userName: string
  address: string
  status: Status
  adding?: boolean
  to?: string
  onOpen?: () => void
  children?: ReactNode
}) {
  const t = useT()
  return (
    <li
      className={cn(
        tile,
        'group relative bg-card inset-ring inset-ring-star/15',
        toneOf(status),
        // the link's focus, not the settings button's, which shows its own
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
      {children}
    </li>
  )
}

// Adding a server, trying a failed add again from what was typed (`adding`), or changing a kept one (`server`): where
// it is, the user to sign in as (an Emby user may have no password), and a 备注 to call it by if its own name won't
// do. An add closes at once and goes on in its tile, so only text that isn't an address is caught here; a failed one
// opens with why it failed. A change waits for its answer, as one that fails changes nothing and has no tile to say
// why: it says so here, under the field it's about. A kept server is removed here too, on a second press, and a failed
// add on the first, having no sign-in to lose.
function ServerDialog({
  dialog,
  server,
  adding,
}: {
  dialog: RefObject<HTMLDialogElement | null>
  server?: Server
  adding?: Adding
}) {
  const t = useT()
  const [failed, setFailed] = useState<EmbyError>()
  const [saving, setSaving] = useState(false)
  // 移除 asks once more, and forgets it was asked after a moment, or when the dialog closes
  const [sure, setSure] = useState(false)
  const unsure = useRef<ReturnType<typeof setTimeout>>(undefined)
  const shown = failed ?? adding?.error
  // An add typed without a scheme that met an untrusted https: what to type for a server with no https. Never for
  // https typed, or a kept server, whose certificate gone bad is no reason to go over http.
  const typedBare = !!adding && !failed && !/^https?:\/\//i.test(adding.form.address.trim())
  const why =
    shown &&
    [
      errorText(shown, t),
      shown.kind === 'untrusted' &&
        typedBare &&
        t(
          '服务器只开了 http 的话，地址写成 http://地址:端口，Emby 默认是 8096，比如 http://192.168.1.5:8096。',
          "If the server only has http, write the address as http://address:port; Emby's default is 8096, as in http://192.168.1.5:8096.",
        ),
    ]
      .filter(Boolean)
      .join(' ')
  const remove = server ? () => removeServer(server) : adding && (() => dismiss(adding))
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    // its inputs are named as a Form's fields are
    const data = new FormData(e.currentTarget)
    const field = (name: keyof Form) => String(data.get(name) ?? '')
    const form: Form = {
      address: field('address'),
      username: field('username'),
      password: field('password'),
      nickname: field('nickname'),
    }
    if (server) {
      setSaving(true)
      setFailed(undefined)
      editServer(server, form)
        .then(() => dialog.current?.close(), setFailed)
        .finally(() => setSaving(false))
      return
    }
    try {
      addServer(form, adding)
    } catch (err) {
      if (!(err instanceof TypeError)) throw err
      return setFailed({ kind: 'notAnAddress' })
    }
    dialog.current?.close()
  }
  return (
    <dialog
      ref={dialog}
      // a change under way can't be called off, so it stays open until it's answered
      onCancel={(e) => saving && e.preventDefault()}
      // what was typed goes with it, however it closes, back to what it opened with: nothing for an add, and a failed
      // add's own, its password too
      onClose={(e) => {
        setFailed(undefined)
        setSure(false)
        clearTimeout(unsure.current)
        e.currentTarget.querySelector('form')?.reset()
      }}
      aria-label={server ? t('服务器设置', 'Server settings') : adding ? t('修改后重试', 'Edit and try again') : t('添加服务器', 'Add server')}
      className={dialogBox}
    >
      <form onSubmit={submit}>
        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <Field
            label={t('地址', 'Address')}
            error={shown?.kind === 'signIn' ? undefined : why}
            name="address"
            defaultValue={server?.address ?? adding?.form.address}
            required
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="192.168.1.5:8096"
          />
          <Field
            label={t('用户名', 'Username')}
            name="username"
            defaultValue={server?.userName ?? adding?.form.username}
            required
            autoCapitalize="off"
            autoComplete="username"
          />
          <Field
            label={t('密码', 'Password')}
            error={shown?.kind === 'signIn' ? why : undefined}
            name="password"
            defaultValue={adding?.form.password}
            type="password"
            autoComplete="current-password"
            placeholder={server ? t('不改就留空', 'Leave empty to stay signed in') : t('没有密码就留空', 'Leave empty if there is none')}
          />
          <Field
            label={t('备注（可选）', 'Nickname (optional)')}
            name="nickname"
            defaultValue={server?.nickname ?? adding?.form.nickname}
            autoComplete="off"
            placeholder={
              server
                ? t(`不填就用服务器自己的名字「${server.name}」`, `Leave empty to use its own name, ${server.name}`)
                : t('不填就用服务器自己的名字', "Leave empty to use the server's own name")
            }
          />
          <div className="flex justify-end gap-2 pt-2">
            {remove && (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={() => {
                  if (sure || !server) {
                    dialog.current?.close()
                    return remove()
                  }
                  setSure(true)
                  unsure.current = setTimeout(() => setSure(false), confirmFor)
                }}
                className={cn('mr-auto text-muted-foreground hover:text-destructive', sure && 'text-destructive')}
              >
                {sure ? t('确认移除', 'Remove?') : t('移除', 'Remove')}
              </Button>
            )}
            <Button type="button" variant="ghost" size="lg" onClick={() => dialog.current?.close()}>
              {t('取消', 'Cancel')}
            </Button>
            <Button type="submit" size="lg">
              {saving ? t('正在保存', 'Saving') : server ? t('保存', 'Save') : t('添加', 'Add')}
            </Button>
          </div>
        </fieldset>
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
