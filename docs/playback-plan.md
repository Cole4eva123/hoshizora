# 播放方案：弹出播放窗口，mpv 画面 + React 控制层

放映室的目标是做成 App（先 Mac），网页版不再连 Emby。Emby 客户端整个放进 Rust：登录、token（只在 Rust 里，前端拿不到）、所有请求、播放和进度回报。前端只管显示。

效果参照 Mac 上的 IINA / Infuse：在作品页点「播放」，弹出一个独立的播放窗口。画面铺满窗口，控制条浮在画面上，鼠标不动就隐去；关掉窗口回到原处，主窗口一直可用。

## 结构

```
┌──────────── 播放窗口（Tauri 第二个窗口）─────────────┐
│  WKWebView，背景透明：React 画控制层                    │  ← 接收全部鼠标、键盘
│    标题、进度条、按钮、音轨字幕菜单、自动隐藏             │
├───────────────────────────────────────────────────┤
│  视频层（原生 NSView）：libmpv 渲染画面和字幕             │  ← 在 WebView 下面
└───────────────────────────────────────────────────┘
        ▲ invoke：播放、暂停、跳转、换轨……   │ 事件：进度、暂停、轨道、结束
        │                                    ▼
┌──────────── Rust（src-tauri）────────────────────────┐
│  开关播放窗口；持有 mpv；观察 mpv 属性，转成事件发给前端     │
└───────────────────────────────────────────────────┘
```

分工：

| 层 | 负责 | 不负责 |
|---|---|---|
| mpv（libmpv） | 读取（含网盘 `.strm` 跳转）、解码、渲染、字幕（ASS、PGS）、音频 | 界面 |
| Rust：`emby-core` 库 | 所有 Emby 请求：找作品、要播放信息、组播放地址、回报进度。token 只有它拿得到 | 界面 |
| Rust：播放 | 建播放窗口和视频层，mpv 的生命周期，把命令转给 mpv，把 mpv 的状态转成事件，**按 mpv 的进度直接回报给 Emby** | — |
| React 控制层 | 控制条和菜单的样子与交互，快捷键，自动隐藏 | 解码、渲染、Emby |

`emby-core` 写成不依赖 Tauri 的独立库，现在外面套 Tauri 命令。哪天要让别的东西也能连 Emby（比如部署在 NAS 上的 HTTP 服务），只需再套一层，不用重写。

## Emby 搬进 Rust（M0.5）

```
前端                           Rust（src-tauri）                                    服务器
src/lib/emby.ts ──invoke──▶ src/lib.rs：6 个命令 ──▶ emby-core：Emby ──HTTP──▶ Emby
  hook、缓存、添加中的卡片、文案   只做转接                 地址探测、登录、token、请求，
                                                       把回答整理成媒体库和作品
```

接缝放在「对一台服务器能做的事」这一层，不是「转发任意请求」：前端说「列出这台服务器的媒体库」，不说「GET /Users/{id}/Views」。Emby 的路径、参数、字段名和 token 全在 emby-core 里；播放（M2）要用的也是这些，放在一处。

`emby-core` 的接口（`src-tauri/emby-core/src/lib.rs`）是一个 `Emby` 值和它的七个方法：

| 方法 | 做什么 | 出错时 |
|---|---|---|
| `Emby::open(file)` | 读出保存的服务器和设备 id；文件不在或读不了，就从空开始 | — |
| `servers()` | 保存的服务器，不带 token | — |
| `add(typed, username, password, nickname)` | 从输入推出要试的地址（原 `candidatesOf`）；https 的几个地址同时试，2 秒内都没答再试 http；跟随跳转，记住落到的地址；登录、保存。同一台服务器同一个用户再登录时，没填备注就保留原来的，旧 token 不同就到服务器上注销 | `NotAnAddress`、`Offline`、`SignIn`（密码错或用户被停用）、`Storage` |
| `remove(server, user)` | 删掉，再在后台到服务器上注销 | `Storage` |
| `status(server, user)` | 现在连得上吗：`Online`、`Offline`、`SignedOut`（token 被拒） | 不出错 |
| `libraries(server, user)` | 电影、剧集的媒体库，按服务器上的顺序，带媒体库封面的地址 | `SignedOut`、`Offline`、`Server(状态码)`、`NoServer` |
| `items(server, user, library, start, limit)` | 一页作品，最新添加的在前：名字、年份、海报地址、TMDB 编号；从第 0 部开始的那页带总数 | 同上 |

Tauri 命令（`src-tauri/src/lib.rs`）和后六个方法一一对应：`emby_servers`、`emby_add`、`emby_remove`、`emby_status`、`emby_libraries`、`emby_items`；`Emby::open` 在 App 启动时调用。命令里不放逻辑。

`src/lib/emby.ts` 之后：
- 页面用的导出不变（`useServers`、`addServer`、`useStatus`、`useLibraries`、`useItems`、`useLineupAfter`……），页面代码基本不改。
- 服务器列表在第一次渲染前取一次（模块顶层 `await`），之后照样在渲染时同步读：从作品页返回服务器页时，要靠第一帧就有数据来恢复滚动位置。
- 缓存键从 URL 换成 `emby/{server}/{user}/{signedIn}/views`、`…/items/{library}/{page}`：带上登录时间，重新登录后换了地址也不会用到旧地址的图片；`refresh` 照旧按前缀忘掉。
- 留在前端的：什么时候查状态（打开页面、回到页面、网络变化）、「添加中」的卡片、跨页去重、`lineupOfItems`、文案。
- `Server` 多一个 `signedIn`（登录的时间）：同一台服务器重新登录后，状态从「正在连接」重新查起，不沿用旧 token 的「登录已失效」。

请求怎么发：
- 客户端和设备信息放在每个 Emby 版本都认的 `X-Emby-Authorization` 头里，token 放 `X-Emby-Token` 头，都不再放在地址里。放地址里原本是为了躲开浏览器的 CORS 预检，Rust 没有这个限制；token 不在地址里，Cloudflare 和反向代理的访问日志就不会记下它。
- 只有探测地址时跟随跳转（记住落到的地址）；登录和带 token 的请求不跟随，免得跳转把 token 或密码带到别的主机。
- 超时照旧：探测 https 2 秒、http 5 秒、登录 10 秒、其他请求 15 秒。
- HTTP 用 reqwest（rustls，按 macOS 的系统证书校验）；同时探测几个地址用 tokio 的 `JoinSet`。

token 存在哪：
- App 数据目录里的 `emby.json`（`~/Library/Application Support/io.github.cole4eva123.hoshizora/`），权限 600，只有 Rust 读写，网页里的脚本拿不到。设备 id 也存在这里。写入时先写临时文件、刷到磁盘再改名；读不了的文件改名成 `emby.unreadable-<时间>.json` 留着，不会被之后的写入覆盖。
- 先不用钥匙串：开发时 App 每重新编译一次，代码签名就变一次，macOS 会弹窗要登录密码，才让新编译的程序读旧条目。等 App 用固定的证书签名后再挪进钥匙串（代码里留 `ponytail:` 注释）。

海报和媒体库封面：还是由 WebView 直接从服务器加载（这些地址不需要 token）。你的服务器是 https 域名，打包后的 App 里能正常显示。http 服务器的图片在打包后的 App 里可能被 macOS 拦下，遇到了再由 Rust 转发图片（`ponytail:` 注释）。

网页版：不再连 Emby。媒体库页说明要用 App，不显示「添加服务器」。网页版 localStorage 里原来的服务器不删，只是不再使用。App 里还没存过服务器，搬完后要在 App 里重新添加一次（要输入密码，得你自己来）。

测试：
- emby-core 的测试走它的接口：测试里用 axum 起一个假的 Emby（127.0.0.1 的随机端口），覆盖登录成功、密码错、连不上、跟随跳转、重新登录保留备注并注销旧 token、状态、媒体库过滤、作品整理和总数、移除时注销、重开 App 后服务器还在。
- 地址推断（原 `candidatesOf`）和跳转落点（原 `landedAt`）是纯逻辑，在 crate 里单测，用例从 `emby.test.ts` 搬过来。`emby.test.ts` 只剩 `lineupOfItems`。
- `cargo test -p emby-core`（在 `src-tauri/` 下）不用编译 Tauri，跑得快。

不在这一步：豆瓣评分走 Rust、收紧 CSP，见步骤表的 M0.6。

## 点播放之后的完整流程

1. **找到服务器上的那一份。**从服务器页点进来的作品，已经知道 Emby 的 item id。从 TMDB 作品页进来的，要按 TMDB 编号到各台服务器上查（`/Users/{userId}/Items?AnyProviderIdEquals=Tmdb.{id}&Recursive=true`，这个参数要先在你的服务器上验证）。剧集按季号、集号对上 Emby 的 `ParentIndexNumber` / `IndexNumber`。
2. **要播放信息（Rust）。**`POST /Items/{id}/PlaybackInfo?UserId=…`，设备描述写「什么都能直接播」，避免转码。拿到 `MediaSources`（版本、音轨、字幕）和 `PlaySessionId`；上次看到哪里在 `UserData.PlaybackPositionTicks`。
3. **组播放地址（Rust）。**`{address}/Videos/{id}/stream?static=true&MediaSourceId=…&PlaySessionId=…&api_key=…`。`.strm` 也用这个地址，Emby 会 302 跳到网盘链接，mpv 会跟着走。地址里带着 token，所以只在 Rust 里组、只交给 mpv。
4. **打开播放窗口。**前端只说是哪台服务器的哪一部：`invoke('player_open', …)`，见下面的接口。Rust 做完第 2、3 步，建窗口（路由 `/player?server=…&user=…&item=…&source=…&session=…`），建视频层，`loadfile` 地址，从上次的位置开始。
5. **开始回报（Rust 里完成，不经过前端）。**mpv 开始播放后，`POST /Sessions/Playing`；之后每 10 秒，以及暂停、跳转时 `POST /Sessions/Playing/Progress`；关窗口时 `POST /Sessions/Playing/Stopped`（位置用 ticks，秒 × 10⁷）。首页的「继续观看」、Emby 的「看过」标记由此而来。
6. **换轨。**菜单列出 mpv 读到的 `track-list`（`.strm` 播放前服务器不知道有哪些轨道，以 mpv 为准）。Emby 的外挂字幕用 `sub-add` 加进去：`/Videos/{id}/{MediaSourceId}/Subtitles/{index}/Stream.{format}`。
7. **关窗口。**`invoke('player_close')`，Rust 先回报 Stopped，Rust 停掉 mpv，销毁窗口。

## 接口

### Rust 命令（前端 → Rust）

```ts
// src/lib/player.ts：前端唯一调用这些命令的地方
invoke('player_open', {
  server: string,       // 服务器 id
  user: string,         // 登录的用户 id
  item: string,         // Emby 的 item id：一部电影，或剧集的一集
  title: string,        // 窗口标题：片名，剧集加「第 N 季第 N 集」
})
// 播放地址、从第几秒开始（UserData）、播放窗口的路由都由 Rust 定：token 不经过前端
invoke('player_command', { cmd: 'pause' | 'play' | 'seek' | 'seekBy' | 'volume' | 'mute'
                                 | 'audio' | 'subtitle' | 'addSubtitle' | 'speed' | 'fullscreen',
                           value?: number | string })
invoke('player_close')
```

### Rust 事件（Rust → 前端）

```ts
// 'player://state'：mpv 属性一变就发，time-pos 限到每秒 4 次
{ position: number, duration: number, paused: boolean, buffering: boolean,
  volume: number, muted: boolean, speed: number, fullscreen: boolean,
  tracks: { id: number, type: 'audio' | 'sub', title?: string, lang?: string, selected: boolean }[] }
// 'player://ended'：播完或出错，带原因
```

### 前端模块

| 文件 | 内容 |
|---|---|
| `src/lib/player.ts`（新） | `play(server, item)`：调 Rust 打开播放；`usePlayer()`：订阅事件，给控制层用；`send(cmd)` |
| `src/lib/emby.ts` | M0.5 起用 `invoke` 调 `emby-core`，把结果交给 `cache.ts`，页面代码不变（见上面「Emby 搬进 Rust」） |
| `src/pages/Player.tsx`（新） | 控制层。这一页的 `body` 不画星空背景，要透明 |
| 作品页、选集、服务器页 | 加「播放」按钮，调 `play` |

### Rust 模块

| 文件 | 内容 |
|---|---|
| `src-tauri/emby-core/`（独立 crate） | 登录与地址探测、保存服务器和 token、媒体库与作品；M2 起加播放信息、播放地址，M5 加进度回报 |
| `src-tauri/src/lib.rs` | `Emby` 交给 Tauri 管理，`emby_*` 命令转给它 |
| `src-tauri/src/player.rs` | 三个命令；窗口；mpv 实例（`libmpv2` crate）；观察属性、发事件；调 `emby-core` 回报进度 |
| `src-tauri/src/video_view.rs`（macOS） | 视频层：一个放在 WKWebView 下面的 NSView，接 mpv 的渲染 |

## 难点：视频层放在透明 WebView 底下

这是唯一没把握的地方，M1 原型专门验证它。

- **首选：mpv 渲染 API（OpenGL），IINA 的做法。**建一个用 `CAOpenGLLayer` 的 NSView，插到窗口 contentView 里 WKWebView 的下面，在 layer 的绘制回调里让 `mpv_render_context` 画一帧。Rust 这边要用 `objc2` 定义一个 Objective-C 子类，是整个方案里最硬的一块代码。
- **备选 1：mpv 的 `wid` 选项。**把那个 NSView 的指针交给 mpv，让它自己往里画。代码最少，但 libmpv 在 macOS 上用 `wid` 能不能正常工作，要实测。
- **备选 2：两个窗口叠在一起。**下面一个原生窗口放视频，上面一个透明的 Tauri 窗口放控制层，跟着移动、缩放、全屏。能做，但窗口同步很繁琐。
- **最后的退路：**播放窗口先用 mpv 自带的控制条（uosc 皮肤）。窗口照样弹出，其余步骤都不用改，以后再回来做叠层。

拖动和缩放：
- 首选和备选 1 里，视频层和控制层都在同一个窗口里。拖动、缩放、全屏时两层一起动，不会错位：视频层设成随窗口自动缩放，控制条用 CSS 贴住底部。
- 和 IINA 一样，在画面上任何地方按住都能拖动窗口：控制层的空白背景标成 `data-tauri-drag-region`，按钮和进度条不标。双击画面切换全屏，要改掉 macOS 默认的双击标题栏放大窗口。
- 备选 2 是两个窗口，上面那个要靠「子窗口」跟着走，缩放、全屏、切换桌面空间时都得另外同步，容易跟不上。这也是它排在后面的原因。

要注意的事：
- WebView 要透明，Tauri 在 macOS 上得打开 `macOSPrivateApi`。用了私有 API 的应用**上不了 Mac App Store**。自己用、直接发 `.app` 不受影响。
- `CAOpenGLLayer` 只输出 SDR。HDR 片源先由 mpv 做色调映射成 SDR（mpv 默认就会），真正的 HDR 输出以后再研究 Metal。
- 控制层的毛玻璃（`backdrop-blur`）只放在控制条上，不铺满整个画面，免得每帧都要模糊整片视频。

## 控制层的样子（M3 时用 frontend-design 定稿）

方向是沿用放映室已有的设计语言：
- 底部浮着一条玻璃控制条，和角落菜单同样的质感（`bg-night/80`、`backdrop-blur-xl`、星光色细边）。
- **进度条是一条星座连线，播放头是一颗发光的星**，已播的部分是亮的连线，缓冲的部分是暗的连线。这是整个播放器唯一的特色元素，其余保持安静。
- 按钮用和菜单一样的星座小图标：播放、暂停、音轨、字幕、全屏。
- 顶部是标题，可以拖动窗口（`data-tauri-drag-region`）。鼠标 2 秒不动，控制条和光标一起隐去。
- 快捷键：空格暂停，← → 跳 10 秒，↑ ↓ 音量，F 全屏，Esc 退出全屏，M 静音。双击画面切换全屏。

## 步骤

| 步骤 | 内容 | 做完能看到 | 风险 |
|---|---|---|---|
| **M0**（已完成） | `tauri init`；Vite 的 `base` 按环境切换（Tauri 用 `/`）；`brew install mpv` 提供 libmpv | 放映室作为 Mac 应用打开，原有功能照常 | 低。豆瓣评分要改走 Tauri 的 HTTP，不再走 dev 代理 |
| **M0.5** | `emby-core`：地址探测、登录、保存服务器和 token、状态、媒体库和作品搬进 Rust；`emby.ts` 改成调 `invoke`；纯逻辑的测试搬到 Rust，再加用假 Emby 跑的接口测试 | 服务器页照常，token 不再出现在前端；网页版不再连 Emby | 中。要在 App 里重新添加一次服务器。http 服务器的海报在打包后的 App 里可能显示不了（你的是 https，不受影响），遇到了再由 Rust 转发图片 |
| **M0.6** | 豆瓣评分改走 Rust（设置页那行说明一起改）；WebView 只剩 TMDB、MDBList 和服务器的图片要连，给 `tauri.conf.json` 加上收紧的 CSP | 打包后的 App 里也有豆瓣评分 | 低 |
| **M1 原型** | 一个按钮弹出播放窗口，mpv 播放一个写死的链接，上面浮一个 React 暂停按钮，点了能暂停 | 叠层在 Mac 上成立 | **高**，按上面的顺序试，不行就走退路 |
| **M2** | `player.rs` 的三个命令和状态事件；`emby-core` 的播放信息和播放地址；作品页、选集、服务器页的播放按钮 | 能从放映室播放你服务器上的片子，包括 `.strm` | 中。`AnyProviderIdEquals` 要实测 |
| **M3** | 控制层：进度、按钮、自动隐藏、快捷键、全屏、拖窗口 | 像一个正经的播放器 | 低 |
| **M4** | 音轨、字幕菜单；Emby 外挂字幕 | 能换国语、英语，换字幕 | 低 |
| **M5** | 回报进度；从上次的位置开始播 | 首页「继续观看」有内容，Emby 上的看过标记对得上 | 低。**会写入你服务器上的播放记录**，测试前先说一声 |

以后再做：
- 一集播完接着播下一集，按 Emby 的片头片尾标记跳过。
- 把 libmpv 打进 `.app`。
- token 挪进钥匙串：等 App 用固定的证书签名之后（见「Emby 搬进 Rust」里的「token 存在哪」）。
- iPhone 版：Tauri 移动端加 iOS 上的 mpv（Metal），是另一套做法。

## 测试

- M0.5 起只有 App 能连服务器：在 `bun run tauri dev` 里只读你的服务器测；M5 会写播放记录，先确认。
- Emby 的逻辑（地址拼接、ticks 换算、TMDB 季集对上 Emby 的集）写在 emby-core 里，用 `cargo test`；要服务器的，用测试里的假 Emby。
