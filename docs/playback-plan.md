# 播放方案

照 IINA 的路线做：点「播放」弹出播放窗口，mpv 画画面，控制条浮在上面。和 IINA 不同的只有两处：控制条用 React 画（样子照 IINA 在 macOS 26 上的，原生最要紧，不套放映室的主题），地址由 Rust 从 Emby 拿。

## 框架

```
作品页的「播放」
   │ player_open
   ▼
Rust ── emby-core：拿到片源自己的链接（.strm 里的那个），token 不交出去
   │
   ▼
播放窗口
   ├─ 上层：透明 WebView，React 控制条
   └─ 下层：CAOpenGLLayer，mpv 往里画（照 IINA 的 ViewLayer）
                │
                └─ mpv 直接去 alist / 网盘 CDN 取片子
```

- **地址**：能直接播的片源（远程链接）直接给 mpv；其余的经服务器播放（见下面「经服务器播放」）。
- **画面层**：照 IINA 的写法，后台线程画，跟屏幕刷新同步。走不通就换 MaxVideoPlayer 的 NSOpenGLView。
- **交互和样子**：都照 IINA 的默认（自动隐藏、提示文字、鼠标和键盘、媒体键；浮动控制条、系统图标、原生菜单）。
- **mpv 设置**：不带请求头、校验证书、User-Agent 和 Rust 一致。

## 借鉴 IINA

参考 `github.com/iina/iina`（GPL-3.0），括号里是要看的文件。

**画面层（M1）**（`ViewLayer.swift`、`VideoView.swift`）
- 画面层用 `CAOpenGLLayer`，插在窗口最底层，mpv 用 render API 往里画
- 在后台线程画，主线程留给界面动画
- 用 CVDisplayLink 跟屏幕刷新同步，暂停 6 秒后停掉省电
- 缩放窗口时不抖、不变形，背景是黑的

**mpv 的接法（M1–M2）**（`MPVController.swift`）
- 选项在初始化之前设，用 `vo=libmpv`
- mpv 一有事件就在自己的线程里读，观察一组属性，再转给界面
- `keep-open`：播完停在最后一帧
- 同一个窗口里换片，不开第二个

**窗口和系统（M2–M3）**（`MainWindowController.swift`、`SleepPreventer.swift`、`NowPlayingInfoManager.swift`）
- 打开时窗口调成视频大小，之后锁住宽高比
- 播放时不让屏幕睡，暂停或停止就放开
- 键盘的播放键、AirPods、控制中心的「正在播放」都能用

**交互（M3）**（`Preference.swift` 里的默认值、`OSDMessage.swift`）
- 鼠标不动 2.5 秒，控制条和光标一起隐去
- 角落提示文字显示 1 秒：暂停、跳转、音量、倍速、换轨、静音
- 鼠标：双击全屏；单击只隐藏控制条，不暂停；右键暂停；竖向滚动调音量，横向滚动拖进度
- 键盘：空格暂停，← → 跳 5 秒，↑ ↓ 音量，回车/Esc 进出全屏，f 切全屏，m 静音，Shift+← → 调字幕时间

**样子（M3，原生化时重做）**（`OSCFloatingView.swift`、`TranslucentView.swift`、`OSDView.swift`、`BufferIndicatorView.swift`、`PlaySliderCell.swift`、`VolumeButton.swift`）
- 底部居中的浮动控制条：宽 460、圆角 12，离底部一成窗高；上排音量、◀◀ ▶ ▶▶、字幕菜单和全屏，下排两个时间夹着进度条
- macOS 26 上是 Liquid Glass。原生的 `NSGlassEffectView` 垫在 WebView 下面会让整个网页看不见，所以用 CSS 仿：`backdrop-filter` 能模糊到下面 mpv 的画面，亮度照原生玻璃量过的减半
- 图标是系统的 SF Symbols，由 Rust 现画成图片（`symbol://`），不随 App 打包；音轨字幕用原生菜单
- 角落提示、等待（系统样式的转圈）也在玻璃框里

**HDR（M6）**（`VideoView.swift`）
- HDR 片源配上支持 EDR 的屏幕：画面层开 EDR，色彩空间用 BT.2100 PQ，mpv 输出 PQ；其他情况用屏幕自己的色彩配置
- 做下来的发现（2026-10-14）：没有色彩管理时，BT.709 的画面直接送到 P3 屏幕，颜色过饱和；用了屏幕的 ICC 配置后，红色和 mpv 自己的窗口量出来一致
- XDR 屏的配置文件黑位是纯黑，mpv 算出的对比度超出范围，整个画面变成一片灰（mpv 自己的窗口也一样），所以设 `icc-force-contrast=inf`
- 杜比视界 Profile 5（没有 HDR10 底层）偏绿偏紫：要靠 gpu-next 重塑，libmpv 的渲染接口没有，IINA 也一样；Profile 8 按 HDR10 显示

**回报进度（M5）**（IINA 不连 Emby，参考 Emby 的 Kodi 插件和 embyToLocalPlayer）
- 开始播放时先让服务器按播放的方式读一遍文件（PlaybackInfo），再报开始；之后每播 10 秒、暂停或继续时报进度；换片或关窗时报停止。三种报告按顺序从一个线程发出
- 做下来的发现（2026-10-14，宸澄上实测）：服务器不知道片长时（没读过的 .strm），停止时会直接把作品算成看完，所以开始前一定要先读文件
- 不先报开始就报停止，新版 Emby 不收；PlaySessionId 用读文件时服务器给的
- Emby 收到进度报告就保存位置，所以 ⌘Q 丢了停止报告，位置最多落后 10 秒
- 关窗时 mpv 先结束文件，位置就读不到了，停止报告要用最后一次知道的位置（第一次实测报成了 0，服务器把位置清空了）
- Emby 4.9 的列表默认不带最后播放时间，要在 Fields 里单独要 `UserDataLastPlayedDate`，否则几台服务器的继续观看没法按时间合并
- 看了不到 5% 不记位置，超过 90% 算看过，这是服务器的设置

**经服务器播放**（2026-10-14，IINA 不连 Emby）
- 直接播放优先，播不了的才经服务器：mpv 连本机 127.0.0.1 上的一个中转，Rust 带上令牌去要服务器的 `/Videos/{id}/stream?static=true`（不转码），把 Range 传过去、数据原样转回来。令牌不进 URL，也不交给 mpv；服务器要是跳转到网盘，地址原样交给 mpv，它自己去取，不带令牌
- 每次播放一个随机名字的链接，只认最近给出的 4 个（同时点了两次播放、或者播放器没打开，都不会断掉正在播的）
- 实测：「明天跑路」的片源链接全是它内网里的 alist（内网 IP:5244），只能经服务器；宸澄约 1–2% 是硬盘上的文件，或服务器自己也打不开的 .strm
- 两台的转发都不跳转，直接回数据。宸澄硬盘上的 mkv 很流畅；「明天跑路」转发只有约 9 Mbit/s，它的原盘 50–90 Mbit/s，会边放边卡，账号也不能转码
- 服务器自己也放不了的：坏掉的 .strm（回 404）、蓝光原盘文件夹（Unable to locate BD structure）

**不借的**
- 拖进度时的预览缩略图：IINA 对网络文件也是默认关掉
- 本地记播放位置：我们用 Emby 记，换设备也能接着看
- 几种控制条布局、大量设置项、插件、音乐模式、画中画、在线字幕、截图
- IINA 不校验证书，我们要校验

## 步骤

| 步骤 | 做完能看到 |
|---|---|
| M1 画面层 | 播放窗口里 mpv 播一个测试视频，上面的 React 按钮能暂停 |
| M2 能播 | 从作品页播宸澄上的电影和剧集，从上次的位置开始 |
| M3 控制层 | 像一个正经的播放器 |
| M4 音轨字幕 | 播放时能换音轨、字幕 |
| M5 回报进度 | 继续观看对得上：首页合并所有服务器的，服务器页只有它自己的（会写服务器的播放记录） |
| M6 HDR | HDR 片源按 HDR 显示 |

以后：自动播下一集、把 libmpv 打进 App、杜比视界 Profile 5。

细节到每一步开工时再定。依据和测量记录在 git 历史里（2026-10-13 的版本）。
