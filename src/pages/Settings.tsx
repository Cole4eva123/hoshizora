import type { ReactNode } from 'react'
import { Page } from '@/components/Page'
import { hasMdblistKey } from '@/lib/ratings'
import { hasToken } from '@/lib/tmdb'

function Status({ label, ok, value = ok ? '已配置' : '未配置' }: { label: string; ok: boolean; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <span>{label}</span>
      <span className={`shrink-0 ${ok ? 'text-primary' : 'text-muted-foreground'}`}>{value}</span>
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
  return (
    <Page title="设置">
      <div className="max-w-2xl space-y-8">
        <Group title="TMDB" note={hasToken ? undefined : '在项目根目录的 .env.local 写入 VITE_TMDB_TOKEN=你的读访问令牌，重启开发服务器后生效。'}>
          <Status label="读访问令牌" ok={hasToken} />
        </Group>
        <Group
          title="评分来源"
          note={
            hasMdblistKey
              ? undefined
              : '到 mdblist.com 免费申请 API 密钥，写进 .env.local 的 VITE_MDBLIST_KEY，就能显示 IMDb、烂番茄和 MAL 评分。'
          }
        >
          <Status label="MDBList 密钥（IMDb、烂番茄、MAL）" ok={hasMdblistKey} />
          <Status
            label="豆瓣"
            ok={import.meta.env.DEV}
            value={import.meta.env.DEV ? '经开发服务器获取' : '网页版暂不支持'}
          />
        </Group>
        <Group title="关于">
          <p className="px-4 py-3.5 text-sm leading-6 text-muted-foreground">本产品使用 TMDB API，但未经 TMDB 认可或认证。</p>
        </Group>
      </div>
    </Page>
  )
}
