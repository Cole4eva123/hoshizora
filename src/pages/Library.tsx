import { EmptyState, Page } from '@/components/Page'
import { useT } from '@/lib/i18n'

export default function Library() {
  const t = useT()
  return (
    <Page title={t('媒体库', 'Library')}>
      <EmptyState title={t('还没有连接 Emby 服务器', 'No Emby server connected')}>
        {t(
          '服务器和它们的媒体库会列在这里。添加地址并登录后，首页、收藏和搜索都会用到里面的作品。',
          'Your servers and their libraries are listed here. Once you add one and sign in, Home, Favorites and Search draw on its titles.',
        )}
      </EmptyState>
    </Page>
  )
}
