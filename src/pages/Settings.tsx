import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type Translate, listOf, useT } from '@/lib/i18n'
import { type Key, type Why, hasBuiltIn, setOwnKey, useOwnKey } from '@/lib/keys'
import { checkMdblist, fromMdblist, hasDouban, ratingSources } from '@/lib/ratings'
import { checkTmdb } from '@/lib/tmdb'

function Status({ label, ok, value }: { label: string; ok: boolean; value?: string }) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <span>{label}</span>
      <span className={`shrink-0 ${ok ? 'text-primary' : 'text-muted-foreground'}`}>
        {value ?? (ok ? t('已配置', 'Set') : t('未配置', 'Not set'))}
      </span>
    </div>
  )
}

// Why a key wasn't kept, in words.
const whyText = (why: Why, name: string, t: Translate) =>
  why === 'rejected'
    ? t(`${name} 没有接受它，看看是不是复制完整了`, `${name} turned it down, check it was copied whole`)
    : typeof why === 'number'
      ? t(`${name} 回了错误 ${why}，没能检查`, `${name} answered with error ${why}, so it wasn't checked`)
      : why === 'unreachable'
        ? t(`连不上 ${name}，没能检查`, `Couldn't reach ${name} to check it`)
        : t('没能存到这台设备上', "Couldn't keep it on this device")
// A service's key: which is in use (the one built in, the user's own, or none), and a field to put one's own in place
// of it, kept only once the service takes it (`check`); taking one's own out goes back to the one built in. What's
// typed is never shown back, nor the key in use.
function KeyField({ k, name, label, check }: { k: Key; name: string; label: string; check: (key: string) => Promise<Why | undefined> }) {
  const t = useT()
  const own = useOwnKey(k)
  const builtIn = hasBuiltIn(k)
  const [typed, setTyped] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<Why>()
  const field = useId()
  const why = useId()
  const save = (e: FormEvent) => {
    e.preventDefault()
    // as copied: from an example's header too (Bearer …), or broken over lines; no key holds a space
    const key = typed.replace(/^\s*bearer\s+/i, '').replace(/\s+/g, '')
    if (!key || checking) return
    setChecking(true)
    setError(undefined)
    check(key)
      .then((why) => {
        if (why) return setError(why)
        setOwnKey(k, key)
        // emptied unless it was changed meanwhile
        setTyped((now) => (now === typed ? '' : now))
      })
      .catch(() => setError('unkept'))
      .finally(() => setChecking(false))
  }
  const remove = () => {
    try {
      setOwnKey(k)
      setError(undefined)
    } catch {
      setError('unkept')
    }
  }
  return (
    <form onSubmit={save} className="space-y-3 px-4 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={field}>{label}</label>
        <span className={`shrink-0 ${own || builtIn ? 'text-primary' : 'text-muted-foreground'}`}>
          {own ? t('你自己的', 'Your own') : builtIn ? t('内置', 'Built in') : t('未配置', 'Not set')}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          id={field}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value)
            setError(undefined)
          }}
          placeholder={own ? t('填新的，换掉你现在的', 'A new one, in place of yours') : t('粘贴你自己的', 'Paste your own')}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : why}
          className="h-9"
        />
        <Button type="submit" disabled={!typed.trim() || checking} aria-busy={checking} className="h-9 shrink-0">
          {checking ? t('检查中…', 'Checking…') : t('保存', 'Save')}
        </Button>
      </div>
      {error !== undefined && (
        <p id={why} role="alert" className="text-sm text-destructive">
          {whyText(error, name, t)}
        </p>
      )}
      {own && (
        <button
          type="button"
          onClick={remove}
          disabled={checking}
          className="cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-progress disabled:opacity-50"
        >
          {builtIn ? t('改回内置的', 'Go back to the built-in one') : t('删掉', 'Remove it')}
        </button>
      )}
    </form>
  )
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm text-muted-foreground">{title}</h2>
      <div className="divide-y divide-border rounded-xl bg-card">{children}</div>
      {note && <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground">{note}</p>}
    </section>
  )
}

export default function Settings() {
  const t = useT()
  const mdblist = listOf(fromMdblist.map((s) => t(...s.label)), t)
  return (
    <Page title={t('设置', 'Settings')}>
      <div className="max-w-2xl space-y-8">
        <Group
          title="TMDB"
          note={t(
            '想用自己的：登录 themoviedb.org，在设置 → API 里申请，读访问令牌和 API 密钥都行。只存在这台设备上。',
            'To use your own, sign in at themoviedb.org and ask for one under Settings → API: a read access token or an API key. It stays on this device.',
          )}
        >
          <KeyField k="tmdb" name="TMDB" label={t('令牌', 'Token')} check={checkTmdb} />
        </Group>
        <Group
          title={t('评分来源', 'Rating sources')}
          note={t(
            `到 mdblist.com 免费申请 API 密钥（登录后在 Preferences → API key），填在这里就能显示 ${mdblist} 的评分，每天 1000 次。只存在这台设备上。`,
            `Get a free API key at mdblist.com (signed in, under Preferences → API key) and put it here to show ratings from ${mdblist}, 1000 a day. It stays on this device.`,
          )}
        >
          <KeyField
            k="mdblist"
            name="MDBList"
            label={t(`MDBList 密钥（${mdblist}）`, `MDBList key (${mdblist})`)}
            check={checkMdblist}
          />
          <Status
            label={t(...ratingSources.douban.label)}
            ok={hasDouban}
            value={
              hasDouban
                ? t('经开发服务器获取', 'Through the dev server')
                : t('打包后的网页版和 App 暂不支持', 'Not in the built site or app yet')
            }
          />
        </Group>
        <Group title={t('关于', 'About')}>
          <p className="px-4 py-3.5 text-sm leading-6 text-muted-foreground">
            {t(
              '本产品使用 TMDB API，但未经 TMDB 认可或认证。',
              'This product uses the TMDB API but is not endorsed or certified by TMDB.',
            )}
          </p>
        </Group>
      </div>
    </Page>
  )
}
