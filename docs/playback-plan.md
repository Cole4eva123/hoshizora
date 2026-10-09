# 播放方案：弹出播放窗口，mpv 画面 + React 控制层

放映室的目标是做成 App（先 Mac），网页版不再连 Emby。Emby 客户端整个放进 Rust：登录、token（存钥匙串，前端拿不到）、所有请求、播放和进度回报。前端只管显示。

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
| Rust：`emby-core` 库 | 所有 Emby 请求：找作品、要播放信息、组播放地址、回报进度。token 在钥匙串里，只有它拿得到 | 界面 |
| Rust：播放 | 建播放窗口和视频层，mpv 的生命周期，把命令转给 mpv，把 mpv 的状态转成事件，**按 mpv 的进度直接回报给 Emby** | — |
| React 控制层 | 控制条和菜单的样子与交互，快捷键，自动隐藏 | 解码、渲染、Emby |

`emby-core` 写成不依赖 Tauri 的独立库，现在外面套 Tauri 命令。哪天要让别的东西也能连 Emby（比如部署在 NAS 上的 HTTP 服务），只需再套一层，不用重写。

## 点播放之后的完整流程

1. **找到服务器上的那一份。**从服务器页点进来的作品，已经知道 Emby 的 item id。从 TMDB 作品页进来的，要按 TMDB 编号到各台服务器上查（`/Users/{userId}/Items?AnyProviderIdEquals=Tmdb.{id}&Recursive=true`，这个参数要先在你的服务器上验证）。剧集按季号、集号对上 Emby 的 `ParentIndexNumber` / `IndexNumber`。
2. **要播放信息。**`POST /Items/{id}/PlaybackInfo?UserId=…`，设备描述写「什么都能直接播」，避免转码。拿到 `MediaSources`（版本、音轨、字幕）和 `PlaySessionId`；上次看到哪里在 `UserData.PlaybackPositionTicks`。
3. **组播放地址。**`{address}/Videos/{id}/stream?static=true&MediaSourceId=…&PlaySessionId=…&api_key=…`。`.strm` 也用这个地址，Emby 会 302 跳到网盘链接，mpv 会跟着走。
4. **打开播放窗口。**`invoke('player_open', …)`，见下面的接口。Rust 建窗口（路由 `/player?server=…&user=…&item=…&source=…&session=…`），建视频层，`loadfile` 地址，从上次的位置开始。
5. **开始回报（Rust 里完成，不经过前端）。**mpv 开始播放后，`POST /Sessions/Playing`；之后每 10 秒，以及暂停、跳转时 `POST /Sessions/Playing/Progress`；关窗口时 `POST /Sessions/Playing/Stopped`（位置用 ticks，秒 × 10⁷）。首页的「继续观看」、Emby 的「看过」标记由此而来。
6. **换轨。**菜单列出 mpv 读到的 `track-list`（`.strm` 播放前服务器不知道有哪些轨道，以 mpv 为准）。Emby 的外挂字幕用 `sub-add` 加进去：`/Videos/{id}/{MediaSourceId}/Subtitles/{index}/Stream.{format}`。
7. **关窗口。**`invoke('player_close')`，Rust 先回报 Stopped，Rust 停掉 mpv，销毁窗口。

## 接口

### Rust 命令（前端 → Rust）

```ts
// src/lib/player.ts：前端唯一调用这些命令的地方
invoke('player_open', {
  url: string,          // 第 3 步组好的地址
  title: string,        // 窗口标题：片名，剧集加「第 N 季第 N 集」
  start: number,        // 从第几秒开始
  route: string,        // 播放窗口加载的路由，带 server/user/item/source/session
})
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
| `src/lib/emby.ts` | 变成一层薄壳：用 `invoke` 调 `emby-core`，把结果交给 `cache.ts`，页面代码不变 |
| `src/pages/Player.tsx`（新） | 控制层。这一页的 `body` 不画星空背景，要透明 |
| 作品页、选集、服务器页 | 加「播放」按钮，调 `play` |

### Rust 模块

| 文件 | 内容 |
|---|---|
| `emby-core`（独立 crate） | 登录与地址探测、钥匙串、媒体库与作品、播放信息、进度回报 |
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
| **M0** | `tauri init`；Vite 的 `base` 按环境切换（Tauri 用 `/`）；`brew install mpv` 提供 libmpv | 放映室作为 Mac 应用打开，原有功能照常 | 低。豆瓣评分要改走 Tauri 的 HTTP，不再走 dev 代理 |
| **M0.5** | `emby-core`：登录、钥匙串、媒体库和作品请求搬进 Rust；`emby.ts` 改成调 `invoke`；现有测试搬到 Rust | 服务器页照常，token 不再出现在前端。豆瓣评分也改走 Rust（设置页那行说明一起改）；WebView 只剩 TMDB、MDBList 要连，给 `tauri.conf.json` 加上收紧的 CSP | 中。http 服务器的海报在 Tauri 里能否显示要实测，不行就由 Rust 转发图片 |
| **M1 原型** | 一个按钮弹出播放窗口，mpv 播放一个写死的链接，上面浮一个 React 暂停按钮，点了能暂停 | 叠层在 Mac 上成立 | **高**，按上面的顺序试，不行就走退路 |
| **M2** | `player.rs` 的三个命令和状态事件；`emby.ts` 的 `playbackInfo`、`streamUrl`；作品页、选集、服务器页的播放按钮 | 能从放映室播放你服务器上的片子，包括 `.strm` | 中。`AnyProviderIdEquals` 要实测 |
| **M3** | 控制层：进度、按钮、自动隐藏、快捷键、全屏、拖窗口 | 像一个正经的播放器 | 低 |
| **M4** | 音轨、字幕菜单；Emby 外挂字幕 | 能换国语、英语，换字幕 | 低 |
| **M5** | 回报进度；从上次的位置开始播 | 首页「继续观看」有内容，Emby 上的看过标记对得上 | 低。**会写入你服务器上的播放记录**，测试前先说一声 |

以后再做：
- 一集播完接着播下一集，按 Emby 的片头片尾标记跳过。
- 把 libmpv 打进 `.app`。
- token 挪到 Keychain。
- iPhone 版：Tauri 移动端加 iOS 上的 mpv（Metal），是另一套做法。

## 测试

- M1、M2 只读你的服务器，在 5173 上测；M5 会写播放记录，先确认。
- 纯逻辑（地址拼接、ticks 换算、TMDB 季集对上 Emby 的集）写 `bun:test`，和 `emby.test.ts` 放在一起。
