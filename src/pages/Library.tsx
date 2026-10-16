import { type ComponentProps, type ReactNode, type RefObject, type SubmitEvent, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { Constellation, ServerMark } from '@/components/Constellation'
import { EmptyState, Page } from '@/components/Page'
import { Failed, Frame, Row, StillSkeletons, coverTrack } from '@/components/PosterRow'
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
  useLibraries,
  useServers,
  useStatus,
} from '@/lib/emby'
import { useT } from '@/lib/i18n'
import { cn, confirmFor, dialogBox, mostCols, serverHref, sliders, toneOf } from '@/lib/utils'

// Each kept server as a row of its 媒体库 covers (picked from a prototype: git stash "prototype: 媒体库页", A of three),
// a server being added under them, then the line that adds one.
export default function Library() {
  const t = useT()
  const servers = useServers()
  const adding = useAdding()
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
      {!servers.length && !adding.length && (
        <EmptyState title={t('还没有连接 Emby 服务器', 'No Emby server connected')}>
          {t(
            '服务器和它们的媒体库会列在这里。添加地址并登录后，首页和搜索都会用到里面的作品。',
            'Your servers and their libraries are listed here. Once you add one and sign in, Home and Search draw on its titles.',
          )}
        </EmptyState>
      )}
      {/* the rows run to the screen's edges, past the page's gutter */}
      <ul className="-mx-(--gutter) space-y-12 md:space-y-14">
        {servers.map((s) => (
          <li key={`${s.id}/${s.userId}`}>
            <KeptServer server={s} />
          </li>
        ))}
        {adding.map((a) => (
          // one under way can't be stopped or changed, and a failed one's sliders open what was typed
          <li key={a.id}>
            <ServerRow {...a} adding settings={a.status !== 'checking' && <Settings adding={a} />} />
          </li>
        ))}
      </ul>
      <button
        onClick={() => dialog.current?.showModal()}
        className="mt-12 inline-flex cursor-pointer items-center gap-2 rounded-sm text-sm text-star/70 transition-colors hover:text-star"
      >
        <Plus className="size-4" strokeWidth={1.5} />
        {t('添加服务器', 'Add server')}
      </button>
      <ServerDialog dialog={dialog} />
    </Page>
  )
}

// A kept server, as it answers now, heading its 媒体库 covers, each opening the server's page on that one.
function KeptServer({ server }: { server: Server }) {
  const t = useT()
  const status = useStatus(server)
  const { libraries, error, retry } = useLibraries(server, status)
  const to = serverHref(server)
  // opened afresh, by its name or a cover: what the server added since is there
  const open = () => refresh(server)
  return (
    <ServerRow
      {...server}
      name={nameOf(server)}
      status={status}
      to={to}
      onOpen={open}
      settings={<Settings server={server} />}
      // why its 媒体库 couldn't be listed, only while the server answers: else its light says so (a signed-out one's
      // 重试 couldn't help)
      more={
        error && status === 'online' ? (
          <Failed error={error} retry={retry} className="text-xs" />
        ) : (
          libraries?.length === 0 && <span>{t('没有电影或剧集', 'No movies or series')}</span>
        )
      }
    >
      {libraries
        ? libraries.map((l) => (
            <Link key={l.id} to={`${to}?lib=${encodeURIComponent(l.id)}`} onClick={open} viewTransition className="group snap-start">
              <Frame src={l.cover} className="aspect-video transition group-hover:outline-star/60 group-active:scale-[.98]" />
              <p className="mt-2 truncate text-sm transition-colors group-hover:text-star">{l.name}</p>
            </Link>
          ))
        : // not for one known not to answer, whose request is only waiting to fail
          !error && (status === 'online' || status === 'checking') && <StillSkeletons n={mostCols(coverTrack)} />}
    </ServerRow>
  )
}

// A server as a row of 媒体库 covers (`children`; a server being added has none yet), headed by its mark, whose star is
// its light, and its name, a link to its page once it's kept (`to`, with `onOpen` as it's followed); under them how it
// answers in words too, for anyone who can't tell red from green and for screen readers (read out as it changes for one
// being `adding`, as that may fail after the dialog has closed), who's signed in where, its `settings` (the sliders),
// and `more` after them.
function ServerRow({
  name,
  userName,
  address,
  status,
  adding,
  to,
  onOpen,
  settings,
  more,
  children,
}: Pick<Server, 'name' | 'userName' | 'address'> & {
  status: Status
  adding?: boolean
  to?: string
  onOpen?: () => void
  settings: ReactNode
  more?: ReactNode
  children?: ReactNode
}) {
  const t = useT()
  return (
    <Row
      title={
        // a long name (a 备注) cut short rather than wrapped
        <span className="flex min-w-0 items-center gap-2.5">
          <ServerMark status={status} className="size-[1.6em]" />
          {to ? (
            <Link to={to} onClick={onOpen} viewTransition className="truncate transition-colors hover:text-star">
              {name}
            </Link>
          ) : (
            <span className="truncate">{name}</span>
          )}
        </span>
      }
      extra={
        <div className={cn('mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground', toneOf(status))}>
          {/* one line, the user and address cut short on a phone, so the sliders stay at its end */}
          <div className="flex max-w-full min-w-0 items-center gap-x-3">
            <span role={adding ? 'status' : undefined} className="shrink-0 text-tone">
              {statusText(status, t)}
            </span>
            <span className="truncate">{userName}</span>
            <span className="truncate">{new URL(address).host}</span>
            {settings}
          </div>
          {more}
        </div>
      }
      track={coverTrack}
    >
      {children}
    </Row>
  )
}

// The sliders at the end of a server's line, and the dialog they open: a kept server's settings, or a failed add's, to
// try it again from what was typed.
function Settings({ server, adding }: { server?: Server; adding?: Adding }) {
  const t = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button
        onClick={() => dialog.current?.showModal()}
        title={server ? t('服务器设置', 'Server settings') : t('修改后重试', 'Edit and try again')}
        className="-my-1 shrink-0 cursor-pointer rounded-md p-1 text-star/60 transition-colors hover:text-star focus-visible:text-star"
      >
        <Constellation lines={sliders} className="size-4.5" />
      </button>
      <ServerDialog dialog={dialog} server={server} adding={adding} />
    </>
  )
}

// Adding a server, trying a failed add again from what was typed (`adding`), or changing a kept one (`server`): where
// it is, the user to sign in as (an Emby user may have no password), and a 备注 to call it by if its own name won't
// do. An add closes at once and goes on under the rows, so only text that isn't an address is caught here; a failed one
// opens with why it failed. A change waits for its answer, as one that fails changes nothing and has no entry to say
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
