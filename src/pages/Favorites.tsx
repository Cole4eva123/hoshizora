import { EmptyState, Page, ToLibrary } from '@/components/Page'

export default function Favorites() {
  return (
    <Page title="收藏">
      <EmptyState title="还没有收藏">
        你在 Emby 里收藏的电影和剧集会同步到这里。先去
        <ToLibrary />
        连接服务器。
      </EmptyState>
    </Page>
  )
}
