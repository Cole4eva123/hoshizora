import { EmptyState, Page } from '@/components/Page'

export default function Library() {
  return (
    <Page title="媒体库">
      <EmptyState title="还没有连接 Emby 服务器">
        服务器和它们的媒体库会列在这里。添加地址并登录后，首页、收藏和搜索都会用到里面的作品。
      </EmptyState>
    </Page>
  )
}
