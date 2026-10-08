# 放映室 · hoshizora

一个自用的 Emby 播放器前端：在 TMDB 上发现和了解作品，在自己的 Emby 服务器上观看。界面支持简体中文和英文，在右上角切换。

## 现在能做的

- 首页：画报墙和各个分类的海报行（热门电影、韩剧、美剧、国产剧、日剧、动漫、纪录片……）
- 分类页：按热门 / 最新（最早）/ 高分 / 口碑排序，按类型筛选，滚动加载
- 搜索：输入停顿后自动搜索，兼容拼音输入法
- 作品页：片名艺术字、评分（TMDB、IMDb、烂番茄、MAL、豆瓣）、季和集、演员，可以在来源列表里切换上一部 / 下一部
- 演员页：个人信息和作品

还没做：接入 Emby 服务器（媒体库、收藏、继续观看、在服务器上搜索）。

## 运行

需要 [Bun](https://bun.sh)。

```sh
bun install
bun run dev      # http://localhost:5173/hoshizora/
bun run build    # 输出到 dist/
bun test
bun run lint
```

在 `.env.local` 里放密钥：

```sh
VITE_TMDB_TOKEN=...   # TMDB read access token，必需
VITE_MDBLIST_KEY=...  # MDBList，可选，用来显示 IMDb / 烂番茄 / MAL 评分
```

豆瓣评分走 Vite 的开发代理，所以只在 `bun run dev` 下能用。

## 技术栈

React 19、React Router 7、TypeScript、Vite、Tailwind CSS v4、shadcn/ui、Axios。
