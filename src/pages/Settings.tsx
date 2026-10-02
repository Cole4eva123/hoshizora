import { Page } from '@/components/Page'
import { hasToken } from '@/lib/tmdb'

export default function Settings() {
  return (
    <Page title="设置">
      <div className="max-w-2xl space-y-8">
        <section>
          <h2 className="mb-2 px-1 text-sm text-muted-foreground">TMDB</h2>
          <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3.5">
            <span>读访问令牌</span>
            <span className={hasToken ? 'text-primary' : 'text-muted-foreground'}>{hasToken ? '已配置' : '未配置'}</span>
          </div>
          {!hasToken && (
            <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground">
              在项目根目录的 .env.local 写入 VITE_TMDB_TOKEN=你的读访问令牌，重启开发服务器后生效。
            </p>
          )}
        </section>
        <section>
          <h2 className="mb-2 px-1 text-sm text-muted-foreground">关于</h2>
          <p className="rounded-xl bg-card px-4 py-3.5 text-sm leading-6 text-muted-foreground">
            本产品使用 TMDB API，但未经 TMDB 认可或认证。
          </p>
        </section>
      </div>
    </Page>
  )
}
