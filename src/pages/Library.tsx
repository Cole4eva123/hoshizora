import { Server } from 'lucide-react'
import { EmptyState, Page } from '@/components/Page'

export default function Library() {
  return (
    <Page title="媒体库">
      <EmptyState icon={Server} title="还没有连接 Emby 服务器">
        服务器会列在这里。添加地址并登录后，首页、收藏和搜索都会用到它的片库。
      </EmptyState>
    </Page>
  )
}
