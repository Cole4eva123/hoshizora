import { Link } from 'react-router'
import { Heart } from 'lucide-react'
import { EmptyState, Page } from '@/components/Page'

export default function Favorites() {
  return (
    <Page title="收藏">
      <EmptyState icon={Heart} title="还没有收藏">
        你在 Emby 里收藏的电影和剧集会同步到这里。先去
        <Link to="/library" className="text-primary hover:underline">
          媒体库
        </Link>
        连接服务器。
      </EmptyState>
    </Page>
  )
}
