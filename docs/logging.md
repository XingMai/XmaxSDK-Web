# 日志开关

通过 `XmaxConfiguration.loggerOptions` 配置日志类型，默认 `none`：

```ts
import { XmaxClient, XmaxConfiguration, XmaxLoggerOption } from "@xmax/sdk";

const client = new XmaxClient(new XmaxConfiguration({
  apiKey,
  loggerOptions: XmaxLoggerOption.all,
}));
```

- `none`：关闭 XmaxSDK 日志。
- `business`：API、房间、媒体、生成等业务日志。
- `performance`：RTC 网络质量与音视频运行统计。
- `all`：同时开启业务与性能日志。

日志配置全局生效，新客户端的配置会覆盖旧配置。
运行期间也可通过 `XmaxLogger.configure(options, environment)` 切换。
国内环境的日志细项使用中文，海外环境使用英文；标题保持双语。
浏览器 Console 的首行仅显示蓝底白字的 `[Xmax]` 品牌标签和深灰蓝底白字的 `[RTC]`、`[Stream]`
等业务域标签；日志标题与正文统一从第二行开始，两类标签颜色不同。非页面环境（如 Node / SSR）使用纯文本
`[Xmax][分类]` 前缀。

## RTC 性能日志

进房后监听 TRTC 的 `statistics` 和 `network-quality` 事件（通常各每 2 秒一次），
经 `XmaxLogger.rtc.info` 输出到 `console.info`，前缀为 `[Xmax][RTC]`。
浏览器 DevTools Console 默认日志级别即可查看，无需开启 Verbose / 详细。
当前 React Demo 使用 `all`，进房后即可查看这些日志。

输出指标包括 SDK 到云端 RTT、上/下行丢包率、累计收发字节数，
本地及远端音视频的码率、视频分辨率与帧率、音量，
以及远端播放缓冲延迟、RTC 端到端延迟估算值。
网络质量日志另列上行和下行平均 RTT、丢包率及质量等级。

延迟单位为 ms，码率为 kbps，帧率为 fps，丢包率直接使用 TRTC 的百分数，
不会再乘 100。缺失、负数或非有限数值显示 `—`，有效的 0 保留。
`point2pointDelay` 在当前 TRTC 的类型声明中缺失，按可选运行时字段读取；
该估算值不应直接视为摄像头输入到 AI 推理结果回显的完整延迟。

只输出指定统计字段，不打印原始统计负载或会话凭证。
关闭性能日志时不格式化统计文本；退房后停止输出，销毁时移除统计监听。
创建 TRTC 实例前调用 `TRTC.setLogLevel(5)`（NONE）关闭其自身的 console 日志，
保留默认的诊断日志上传。XmaxSDK 的日志仍由 `loggerOptions` 控制。
升级此行为后需刷新页面并重新启动会话，才能替换已经创建的引擎实例。

## 本地视频统计回调

`XmaxRealtimeManaging.setLocalVideoStatisticsListener` 提供本地主视频流的实际发送统计，
与 `loggerOptions` 无关，关闭 console 日志后也能驱动 UI：

```ts
await realtime.setLocalVideoStatisticsListener((statistics) => {
  // statistics: VideoStatistics | undefined
  // width / height: 实际分辨率；frameRate: fps；bitrateKbps: kbps。
  // React: setLocalVideoStatistics(statistics)
});
```

注册时立即回放最新快照，发布完成后按 TRTC 的统计周期更新。
仅选择本地主视频（big），不使用远端、小流或屏幕共享的指标。
未收到统计、主流统计消失、断开或停止时显示为空；缺失或无效字段为 undefined。
有效的零帧率、零码率会保留。快照不可变，监听器异常不会影响生成。
传入 `undefined` 取消监听。

Demo 将分辨率、帧率和码率显示在 Local 左上角，位于启动耗时统计下方。

## 生成结果视频统计回调

`XmaxRealtimeManaging.setRemoteVideoStatisticsListener` 提供当前实际生成结果流的统计：

```ts
await realtime.setRemoteVideoStatisticsListener((statistics) => {
  // statistics: RemoteVideoStatistics | undefined
  // userID / width / height / frameRate / bitrateKbps / rttMs / endToEndDelayMs
  // React: setRemoteVideoStatistics(statistics)
});
```

SDK 按当前已接受的生成结果流用户标识筛选远端主视频统计，不取第一路远端流，
也不使用本地、音频、小流或屏幕共享指标。Demo 在 Result 左上角显示五项统计。
`rttMs` 为本端 SDK 与 TRTC 云端的往返延迟，不是与生成机器人之间的 RTT；
`endToEndDelayMs` 来自该远端视频的 `point2pointDelay`，是 RTC 媒体延迟估算，
不代表包含 AI 推理的完整链路耗时。缺失时保持 undefined，不以播放缓冲延迟替代。

监听独立于日志开关，立即回放最新不可变快照，按统计事件周期更新。
当前结果流统计缺失、流消失、停止或断开时清空；重新发布或重连后等待新采样。
传入 undefined 取消监听。监听器异常不会影响生成。
