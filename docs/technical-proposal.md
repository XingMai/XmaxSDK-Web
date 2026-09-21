# XmaxSDK Web 技术方案（v0 草案）

> 目标：用 JS/TS 实现与 iOS XmaxSDK 对齐的 Web SDK，首版聚焦**摄像头实时生成管线**，
> RTC 由火山引擎切换为**腾讯 TRTC（trtc-sdk-v5）**。
> 对齐基准：`/Users/xmax.ai/dev/Xmax/iOS/XmaxSDK`（分层、命名、状态机、信令流）。

---

## 1. 工程环境

| 项 | 选型 | 说明 |
| --- | --- | --- |
| 仓库结构 | pnpm workspace monorepo | `packages/xmax-sdk` + `examples/xlab-react` |
| 语言 | TypeScript 5.x（strict） | 公开 API 全部带类型声明 |
| SDK 构建 | tsup（Rollup 封装） | 输出 ESM + CJS + `.d.ts`，target ES2020 |
| 包管理 | pnpm 9 | workspace 协议引用 SDK |
| 测试 | Vitest | 对齐 iOS Tests 的用例命名（CameraController/RoomController/RealtimeCoordinator…） |
| Lint | ESLint 9 + Prettier | — |
| Examples | React 18 + Vite 5 + TS | 复刻 iOS XLab 的 Realtime 场景 |
| 浏览器目标 | Chrome/Edge 86+（首版保证） | SEI 收发硬约束；Safari 15.4+/Firefox 117+ 需 trtc-sdk-v5 ≥ 5.8.0，首版不保证 |

## 2. 三方依赖（SDK 本体保持极薄）

| 依赖 | 用途 | 对应 iOS |
| --- | --- | --- |
| `trtc-sdk-v5`（≥ 5.6.0） | RTC 引擎（进房、推拉流、自定义消息、网络质量） | VolcEngineRTC |
| 无（fetch 封装） | 业务 API / 心跳 | ApiService（URLSession） |
| `cos-js-sdk-v5` ✅ 已接入（图片直传） | 对象存储上传下载 | Tencent COS SDK |

不引入事件库、状态库等通用依赖；事件用自研极简 emitter。

## 3. 目录组织（分层与命名对齐 iOS）

```
XmaxSDK/
├── package.json                 # pnpm workspace root
├── packages/
│   └── xmax-sdk/
│       └── src/
│           ├── index.ts                       # 公开导出入口
│           ├── Core/
│           │   ├── XmaxClient.ts              # 统一入口（对齐）
│           │   ├── XmaxConfiguration.ts       # apiKey / environment / loggerOptions
│           │   ├── XmaxEnvironment.ts         # china / global → apiBaseURL
│           │   └── Realtime/
│           │       ├── XmaxRealtimeManager.ts        # 公开能力实现（对齐）
│           │       ├── XmaxRealtimeManaging.ts       # interface（对齐 protocol）
│           │       ├── RealtimeConfiguration.ts      # model（插帧字段保留但不实现）
│           │       ├── RealtimeCoordinator.ts        # 操作准入/状态提交/分级清理（对齐 actor 语义）
│           │       ├── RealtimeErrorHandler.ts
│           │       ├── RealtimeModel.ts              # x2-fast-1080p …
│           │       └── RealtimeTiming.ts
│           ├── Foundation/
│           │   ├── Errors/XmaxError.ts               # code 枚举对齐
│           │   ├── Logging/XmaxLogger.ts
│           │   ├── Media/
│           │   │   ├── Camera/CameraPosition.ts          # front/back → RTC 前后置选择
│           │   │   ├── Video/VideoFrame.ts               # 包装 VideoFrame/MediaStreamTrack
│           │   │   ├── Video/VideoRotation.ts
│           │   │   └── Audio/AudioFrame.ts               # 预留
│           │   ├── Permissions/PermissionManager.ts      # 摄像头/麦克风权限查询与申请
│           │   └── RTC/
│           │       ├── RtcManaging.ts              # interface（对齐，内部 TRTC 实现）
│           │       ├── RtcManager.ts               # RtcManaging 的 TRTC 实现
│           │       ├── RtcEngineManager.ts         # TRTC 单例独占租约（对齐）
│           │       ├── RtcEventListener.ts         # interface
│           │       ├── RtcQualityListener.ts
│           │       ├── RtcRemoteVideoSink.ts       # 远端 track → 帧/渲染桥
│           │       ├── RemoteStream.ts
│           │       ├── RoomJoinConfiguration.ts
│           │       ├── VideoEncodingConfiguration.ts
│           │       └── RtcQualityConverter.ts      # TRTC quality → Xmax 网络质量
│           ├── Service/
│           │   ├── Network/ApiService.ts
│           │   └── Realtime/
│           │       ├── RealtimeSessionService.ts   # createSession/heartbeat/closeSession
│           │       ├── RealtimeSession.ts / RealtimeSessionConnection.ts
│           │       ├── RealtimeContext.ts          # prompt / referencePath（对齐）
│           │       ├── RealtimeMediaStream.ts      # id + videoTrack（对齐）
│           │       ├── RealtimeVideoTrack.ts       # 轨道 + 动态元数据（对齐）
│           │       ├── RealtimeVideoFormat.ts      # width/height/fps/码率/编码偏好（对齐）
│           │       ├── RealtimeState.ts            # 七态状态机（对齐）
│           │       ├── RealtimeNetworkQuality.ts
│           │       └── RealtimePoint.ts            # 轨迹点
│           ├── Media/
│           │   ├── Camera/CameraController.ts      # 相机流生命周期（对齐）
│           │   ├── MediaSourceController.ts        # 本地源统一调度
│           │   └── MediaController.ts
│           ├── Stream/
│           │   ├── StreamController.ts             # 传输层门面（对齐）
│           │   ├── Room/RoomController.ts          # 房间生命周期 + 生成信令（对齐）
│           │   ├── Room/RoomEvent.ts               # start/changeCondition/changeTargetSize/stop/tracks/heartbeat
│           │   ├── Room/RoomHeartbeat.ts           # 10s 周期心跳（对齐）
│           │   ├── Room/RoomMessageCodec.ts        # __trtc_chunk__ 拆包/组包（LRU 1000）
│           │   ├── Encoding/EncodingController.ts
│           │   └── Quality/QualityController.ts
│           └── Render/
│               ├── Video/XmaxRealtimeVideoView.ts  # 本地/远端自动切换容器（对齐）
│               ├── Video/XmaxVideoView.ts          # 单轨视图
│               ├── Video/RemoteVideoFramePipeline.ts  # 远端 track → 帧回调（无插帧）
│               ├── Video/VideoRenderRegistry.ts
│               └── Interaction/InteractionController.ts # 轨迹采集 + 坐标映射
├── examples/
│   └── xlab-react/              # React 18 + Vite，复刻 XLab Realtime 场景
└── docs/
```

命名规则：iOS `protocol XxxManaging/Controlling/Servicing` → TS `interface XxxManaging/...`（同名）；
公开类、方法、参数名逐一对齐（`createLocalCameraStream(videoFormat, position, useMicrophone)`、
`startGeneration(context)`、`setStateListener` 等），方便双端文档互查与后续对齐图片/视频管线。

## 4. 实现策略：接口对齐 iOS、内部 TRTC（结论：可行，2 个硬差异需解决）

`RtcManaging` 的 24 个方法逐一映射到 TRTC Web v5：

| iOS（火山） | TRTC Web v5 | 差异评估 |
| --- | --- | --- |
| `RtcEngineManager` 进程级独占 Engine 租约 | `TRTC.create()` 单例 + 同款租约排队 | ✅ 语义保留（Web 也有多业务抢单实例问题） |
| `joinRoom(roomID/userID/token)` | `enterRoom({sdkAppId, strRoomId, userId, userSig, privateMapKey})` | ✅ 凭证全部由 `/session` 的 `modelExtra` 下发（见差异 2） |
| `useExternalVideoSource` + `pushExternalVideoFrame`（逐帧推 NV12） | `startLocalVideo({option:{videoTrack}})` 注入自定义 `MediaStreamTrack` | ✅ 语义等价：Web 以 track 为单位而非逐帧；摄像头管线直接用 TRTC 内部采集（`startLocalVideo({publish:false})` 只采不发，`getVideoTrack()` 取轨给渲染层），浏览器兼容性交给 TRTC 适配；后续图片/视频管线用 `canvas.captureStream` 注入 |
| `configureVideoEncoding` | `startLocalVideo` profile / `updateLocalVideo` | ✅ 码率、fps、分辨率可配；**SEI 要求 H264**，需在发布时锁定 H264 |
| `publish/unpublishLocalVideo/Audio` | `startLocalVideo/stopLocalVideo`、`startLocalAudio/stopLocalAudio`（`muteLocalAudio`） | ✅ |
| `subscribeRemoteVideo/Audio` | `startRemoteVideo/stopRemoteVideo`、`muteRemoteAudio` | ✅ |
| `setRemoteVideoFrameListener`（解码 YUV 帧） | `startRemoteVideo` 后取 `MediaStreamTrack` → `<video>` + `requestVideoFrameCallback` | ✅ 无插帧版本直接渲染 + 可选帧回调 |
| `setRemoteAudioVolume` | 远端 `<audio>` 元素音量 / `muteRemoteAudio` | ✅ 渲染层实现 |
| 网络质量回调 | `TRTC.EVENT.NETWORK_QUALITY`（uplink/downlink） | ✅ `RtcQualityConverter` 映射 |
| 性能告警 | Web 无等价物 | ➖ 首版保留接口、空实现或基于本地帧率自测 |
| 收 SEI（taskID 匹配确认） | 首版不启用 | ✅ 远端结果流确认改为监听 bot 的 `REMOTE_VIDEO_AVAILABLE`；不锁 H264；后续需要时再 `TRTC.create({enableSEI:true})` |
| `sendRoomMessage`（**全部生成信令 + 房间心跳的载体**） | `trtc.sendCustomMessage({cmdId, data})`（v5.6.0+） | ✅ 已确认存在；独立数据通道、有序、尽可能可靠（问题 Q2 已解决，注意 1KB 上限） |

### 差异 1：信令通道（已解决）

iOS 的 `start / changeCondition / changeTargetSize / stop / tracks / heartbeat` 全部走火山房间消息。
已确认 TRTC Web v5.6.0+ 提供 `sendCustomMessage({cmdId, data})`：**独立数据通道、与音视频流无关、
有序且尽可能可靠**，接收端监听 `TRTC.EVENT.CUSTOM_MESSAGE`。与火山房间消息语义基本等价，
`RtcManaging.sendRoomMessage` 直接映射，`RoomController` / `RoomEvent` / `RoomHeartbeat` 全部不变。

注意点（依据服务端《TRTC 客户端接入说明》与《TRTC 自定义消息拆包协议》）：

- **版本下限**：`trtc-sdk-v5` 依赖锁 ≥ 5.6.0。
- **cmdId 固定为 1**：服务端契约统一 `cmd_id=1`，不按消息类型分通道。
- **拆包协议**：业务 JSON UTF-8 长度 ≤ 800 字节直接发送；> 800 字节按
  `__trtc_chunk__` 分片协议拆发（eventId/index/count/data），接收端按
  `(senderUid, eventId)` 乱序组包、LRU 缓存 1000 条、拼齐后 JSON 解析再进业务链路。
  收发两侧都要实现，日志按协议第 8 节输出。
- **广播语义 + 目标过滤**：TRTC 通道只有房间广播，"定向"靠业务 JSON 里的
  `user_id` / `uid` 字段表达；收到消息后先解析、再按目标字段过滤，不是发给自己的就丢弃。
- **角色限制**：仅 `ROLE_ANCHOR` 可发；SCENE_RTC（默认场景）天然满足。

### 差异 2：RTC 凭证（已确认，以服务端文档为准）

`POST /session` 响应的 `data.modelExtra` 携带全部 TRTC 入房参数（`provider=trtc` 时）：

| `modelExtra` 字段 | TRTC `enterRoom` 参数 | 说明 |
| --- | --- | --- |
| `provider` | — | 先判断；`trtc` 才走本 SDK 逻辑，否则抛不支持错误 |
| `room_id` | `strRoomId` | 字符串房间号（配套 `private_map_key_with_string_room_id`） |
| `rtc_app_id` | `sdkAppId` | 服务端按字符串返回，进房时转 number |
| `rtc_user_id` | `userId` | TRTC 登录身份，**不能用业务 `user_id`** |
| `user_sig` | `userSig` | 登录签名 |
| `private_map_key_with_string_room_id` | `privateMapKey` | 进房鉴权字段 |
| `rtc_bot_id` / `bot_name` | — | 远端生成流的用户标识，用于 `REMOTE_VIDEO_AVAILABLE` 匹配 |

`RealtimeSessionConnection` 相应扩展为 `{ roomID, userID, token, sdkAppID, privateMapKey, botName }`（全部字符串）。

凭证刷新规则（服务端文档第 8 节）：

- 会话存活期间周期 `PUT /session/{sessionUid}/heartbeat`，成功后用最新 `modelExtra` 覆盖本地缓存。
- 仅 `user_sig` / `private_map_key` 变化视为凭据刷新——TRTC Web 不支持房间内热更新凭据，按本端策略重新进房。
- `provider` / `room_id` / `rtc_app_id` / `rtc_user_id` 任一变化视为 RTC 绑定实质变化，需重建 RTC 登录态。

### 其余实现要点

- **状态机**：`RealtimeCoordinator` 的七态（idle→preparing→ready→connecting→connected→generating→disconnecting）
  与"同时只允许一个实时操作 + 分级清理（connection/all）"语义完整移植，TS 用 Promise 链 + 操作租约实现（无 actor，用串行队列）。
- **远端结果流确认（替代 SEI）**：iOS 的 `beginGeneration` 等待 SEI 匹配 taskID 确认结果流；
  首版不发不收 SEI，改为监听 bot 用户的 `REMOTE_VIDEO_AVAILABLE` 作为结果流确认，
  `RealtimeMediaStream`/状态提交语义不变。后续需要 SEI 时再开 `enableSEI` 并锁定 H264。
- **ready 判定**：收到首个有效帧且视图已绑定 → ready（对齐 iOS）。
- **镜像**：前置摄像头本地预览镜像（CSS transform），发布流不镜像（对齐 `configureLocalVideoMirror`）。
- **switchCamera**：Web 上为切换 `useFrontCamera`/cameraId；生成中切换走"停生成→切摄像头→恢复生成"（对齐）。
- **远端首帧渐入**：`XmaxRealtimeVideoView` 远端首帧提交后 0.3s 淡入（对齐）。
- **轨迹交互**：Pointer Events → `InteractionCoordinateMapper`（fill/fit 坐标映射）→ `sendTracks` 信令。

## 5. 渲染层形态（需确认，见 Q4）

SDK 核心框架无关，公开两层：

1. `XmaxRealtimeVideoView` —— 命令式 API：`view.attach(el)` / 属性 `localTrack` / `remoteTrack` / `videoContentMode` / `isInteractionEnabled`（对齐 iOS UIView）。
2. `@xmax/react`（可选小包）—— `<XmaxRealtimeVideo localTrack remoteTrack ... />`（对齐 SwiftUI `XmaxRealtimeVideo`），Examples 使用。

## 6. 里程碑

| 里程碑 | 内容 |
| --- | --- |
| M1 摄像头本地管线 ✅ | monorepo 脚手架、XmaxClient/Configuration/Logger/Error、PermissionManager、RtcEngineManager/RtcManager（TRTC 内部采集，只采不发）、CameraController、RealtimeCoordinator 状态机、XmaxRealtimeVideoView 本地预览、Vitest 基础用例 |
| M2 RTC + 生成（核心链路 ✅） | Session 服务 + 心跳（凭据刷新）✅、进房/发布/订阅 ✅、信令通道（自定义消息 + 拆包）✅、connect/startGeneration/disconnect/close ✅、远端流渲染 + 首帧渐入 ✅；待补：网络质量回调、真机联调（R1/R2'） |
| M3 交互 + Examples 完整化 | 轨迹交互（RealtimePoint/轨迹渲染）、xlab-react 完整复刻 XLab Realtime 场景、README/usage 文档 |
| 后续 | 图片流、视频文件流、~~存储服务~~（图片上传 ✅ 已实现）、插帧（WebCodecs）、性能告警 |

## 7. 待确认问题

- ~~Q1（凭证）~~ ✅ 已确认（服务端文档）：`/session` 的 `modelExtra` 下发全套 TRTC 参数
  （`rtc_app_id`/`rtc_user_id`/`user_sig`/`private_map_key_with_string_room_id`/`room_id`），
  心跳刷新凭证，详见差异 2。
- ~~Q2（信令）~~ ✅ 已解决：TRTC Web v5.6.0+ 有 `sendCustomMessage`（独立数据通道、有序、尽可能可靠），
  信令与心跳继续走 RTC 通道，无需服务端改动；注意单条 1KB 上限。
- ~~Q3（SEI）~~ ✅ 已确认：首版不发不收 SEI，远端结果流确认改用 `REMOTE_VIDEO_AVAILABLE`。
- ~~Q4（渲染形态）~~ ✅ 已确认：**A + B**——SDK 核心提供框架无关命令式 `XmaxRealtimeVideoView`（对齐 UIKit），
  另出薄封装 `@xmax/react` 的 `<XmaxRealtimeVideo>`（对齐 SwiftUI），Examples 使用 React 组件。
- ~~Q5（浏览器范围）~~ ✅ 已确认：首版保证**桌面 Chrome / Edge 86+ 与桌面 Safari**；Firefox 尽力兼容；移动端浏览器/WebView 暂不支持。
- ~~Q6（音频）~~ ✅ 已确认：`useMicrophone` 首版保留。
- ~~Q7（发布形态）~~ ✅ 默认：首版仅 workspace 内使用 + Examples 演示，不发布 npm；包名先占 `@xmax/sdk`、`@xmax/react`。

## 8. 实现期风险（不阻塞，随里程碑验证）

- **R1（M2 联调）**：bot 端行为——`REMOTE_VIDEO_AVAILABLE` 作为结果流确认的时机、bot userId 与 session 返回 `botName` 的对应关系，需接真实后端验证。
- ~~R2~~ ✅ 已解决（服务端文档）：`room_id` 按字符串房间号走 `strRoomId`，配套 `privateMapKey` 进房。
- ~~R3~~ ✅ 已解决（拆包协议文档）：信令超 800 字节按 `__trtc_chunk__` 分片协议收发，无超限报错。
- **R2'（M2 联调）**：心跳刷新 `user_sig` 后的重新进房策略需联调验证（TRTC Web 不支持房间内热更新凭据）。
- **R4（M2/M3）**：Safari 桌面验证点——远端音频自动播放（TRTC `enableAutoPlayDialog` 兜底）、音量控制（iOS Safari 不支持 `setRemoteAudioVolume`，桌面正常）。
