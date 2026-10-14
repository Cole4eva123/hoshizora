# 播放方案

照 IINA 的路线做：点「播放」弹出播放窗口，mpv 画画面，控制条浮在上面。和 IINA 不同的只有两处：控制条用 React 画（放映室的样子），地址由 Rust 从 Emby 拿。

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

- **地址**：能直接播的片源（远程链接）直接给 mpv；服务器硬盘上的文件这一轮先不播。
- **画面层**：照 IINA 的写法，后台线程画，跟屏幕刷新同步。走不通就换 MaxVideoPlayer 的 NSOpenGLView。
- **交互**：照 IINA 的默认习惯（自动隐藏、提示文字、鼠标和键盘、媒体键），样子用放映室的。
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

**HDR（M6）**（`VideoView.swift`）
- HDR 片源配上支持 EDR 的屏幕：画面层开 EDR，色彩空间用 BT.2100 PQ，mpv 输出 PQ；其他情况用屏幕自己的色彩配置

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
| M5 回报进度 | 继续观看、看过标记对得上（会写服务器的播放记录） |
| M6 HDR | HDR 片源按 HDR 显示 |

以后：经服务器播放（硬盘上的文件）、自动播下一集、把 libmpv 打进 App。

细节到每一步开工时再定。依据和测量记录在 git 历史里（2026-10-13 的版本）。
