import type { ReactNode } from 'react'
import { Page } from '@/components/Page'
import { useT } from '@/lib/i18n'
import { fromMdblist, hasDouban, hasMdblistKey, ratingSources } from '@/lib/ratings'
import { hasToken } from '@/lib/tmdb'

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
  // "IMDb、烂番茄、MyAnimeList", "IMDb, Rotten Tomatoes, and MyAnimeList"
  const names = fromMdblist.map((s) => t(...s.label))
  const mdblist = t(names.join('、'), new Intl.ListFormat('en').format(names))
  return (
    <Page title={t('设置', 'Settings')}>
      <div className="max-w-2xl space-y-8">
        <Group
          title="TMDB"
          note={
            hasToken
              ? undefined
              : t(
                  '在项目根目录的 .env.local 写入 VITE_TMDB_TOKEN=你的读访问令牌，重启开发服务器后生效。',
                  'Put VITE_TMDB_TOKEN=your read access token in .env.local at the project root, then restart the dev server.',
                )
          }
        >
          <Status label={t('读访问令牌', 'Read access token')} ok={hasToken} />
        </Group>
        <Group
          title={t('评分来源', 'Rating sources')}
          note={
            hasMdblistKey
              ? undefined
              : t(
                  `到 mdblist.com 免费申请 API 密钥，写进 .env.local 的 VITE_MDBLIST_KEY，就能显示 ${mdblist} 的评分。`,
                  `Get a free API key at mdblist.com and put it in .env.local as VITE_MDBLIST_KEY to show ratings from ${mdblist}.`,
                )
          }
        >
          <Status label={t(`MDBList 密钥（${mdblist}）`, `MDBList key (${mdblist})`)} ok={hasMdblistKey} />
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
