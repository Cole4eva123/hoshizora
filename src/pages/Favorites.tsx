import { EmptyState, Page, ToLibrary } from '@/components/Page'
import { useT } from '@/lib/i18n'

export default function Favorites() {
  const t = useT()
  return (
    <Page title={t('收藏', 'Favorites')}>
      <EmptyState title={t('还没有收藏', 'No favorites yet')}>
        {t(
          <>
            你在 Emby 里收藏的电影和剧集会同步到这里。先去
            <ToLibrary />
            连接服务器。
          </>,
          <>
            Movies and series you favorite in Emby show up here. Connect a server in <ToLibrary /> first.
          </>,
        )}
      </EmptyState>
    </Page>
  )
}
