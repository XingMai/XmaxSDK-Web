# Web 远端视频插帧

## 接入范围（已实现）

1. 内置 `framegen@1.4.0` runtime 与自训 `tfact2-ours` 权重，人工初步试用正常，尚待完整推理效果验收。仓库只保留自训模型，原模型备份和回切配置已移除。SDK 构建产物只嵌入自训权重，无需调用方配置 CDN 或复制资源。
2. 提供 `isFrameInterpolationEnabled`、运行时开关及可选 `frameInterpolation` 配置。
3. 保持原始生成与回传尺寸；插帧开关及故障降级只影响客户端渲染，不发送 `change_target_size`。
4. 在远端渲染管线中实现 WebGPU 2× 插帧（最多 60fps）、尺寸过渡、关闭/换轨/卸载清理及原视频降级。
5. 验证配置事务、尺寸规则、帧调度、异步清理与打包；真实 GPU / TRTC 效果单独记录。

## 使用方式

```ts
const realtime = client.createRealtimeManager(new RealtimeConfiguration({
  model: RealtimeModel.x2_fast_1080p,
  frameInterpolation: { enabled: true, targetFrameRate: 60 },
}));

await realtime.setFrameInterpolationEnabled(false);
// 稳定的功能开关状态，适合按钮和状态胶囊。
console.log(realtime.isFrameInterpolationEnabled);
```

默认请求开启，旧配置 `isFrameInterpolationEnabled` 仍受支持；显式
`frameInterpolation.enabled` 优先。仅远端生成画面处理，本地采集/发布/模型输入不变。
`targetFrameRate` 是输出上限（1–60），单个输入帧间隔最多补一帧，因此 15fps 最多输出 30fps。

模型与 runtime 随 SDK 分发；只在开启且能力可用时创建 GPU 资源。
约 2.95MB 原始权重编码进 JS（base64 约 3.93MB），ESM/CJS 单份产物约 4MB，
由应用正常打包和传输，无独立模型 fetch。`pnpm --filter @xmaxai/web-sdk build` 会按 `models/active-model.json` 的选择重新生成资源，并校验权重 SHA-256 和 manifest。
要求安全上下文、WebGPU、`shader-f16` 与 `requestVideoFrameCallback`，按能力检测而非浏览器名称判断。
首次默认开启不支持时直接播放原视频；显式运行时开启不支持时抛出
`FRAME_INTERPOLATION_UNSUPPORTED`，现有生成继续运行。

插帧不设置固定像素总量上限，也不降低回传分辨率。
例如 `1920×1024`、`1280×720` 均按原始尺寸处理；开启、关闭、失败降级都不改变服务端回传尺寸。
仅保留实际 GPU 纹理尺寸限制和运行时性能降级。尺寸暂不匹配时直接显示原视频；
GPU 内补齐为 16 的倍数并裁去补边，保持原始分辨率与比例。
这是两帧插值，需要缓存前一帧；增加的显示延迟与源帧间隔、GPU 耗时和浏览器调度有关。
音频仍由 RTC 播放，首版不额外延迟音频，启用远端音频时需要验证音画同步。

RTC 统计仍反映收到的原始远端流帧率；不将插帧后的显示帧率混入网络统计。
插帧初始化或处理失败时记录日志并直接显示原视频，保持生成任务和回传尺寸不变，
不将其误报为连接故障。原视频首帧照常显示，不等待模型编译。

## 验证

- SDK 单元测试覆盖配置优先级、原始尺寸保留、能力检测、开关和故障不发送尺寸信令、迟到回调、GPU 超时和卸载清理。
- 原模型接入基线：本机 Chrome WebGPU 已运行 320×180、1248×702 合成 MediaStream，实际输出插帧，
  验证关闭、重新开启、卸载、重新挂载和停止；无 GPU 初始化或处理错误。
- 独立验证页：使用 Vite 以 `packages/xmax-sdk` 为根目录启动，访问
  `/tests/browser/interpolation.html?width=1248&height=702`。不使用摄像头或 API Key。
- 尚需用真实 TRTC 生成视频验证长时间性能、网络抖动、画面突变与音画同步；测试通过不代表所有设备均能稳定 60fps。

React 的 `XmaxVideo` 与 `XmaxRealtimeVideo` 共用底层视频视图，无需增加组件 props：Manager
配置随远端轨道的渲染绑定传入视图，自定义直接播放 `mediaStreamTrack` 的视频元素不会自动插帧。

能力查询使用 `await media.supportsFrameInterpolation(size)`，因为 WebGPU 适配器探测是异步的。
`media.resolveFrameInterpolationSize(size)` 仅校验并返回原始整数尺寸，不执行缩放。
`isFrameInterpolationEnabled` 表示功能开关，不随首帧等待、跳帧、短暂断流或视图挂载变化；
能力检测不支持或真正故障降级时关闭。停止会话保留该开关配置，重新生成时重新检查能力。

## 模型替换

当前仅使用 `tfact2-ours` 自训模型，`packages/xmax-sdk/models/active-model.json` 记录该模型标识。
更新模型并重新构建后，需刷新页面并重建视频会话，避免旧会话继续使用缓存的 GPU 权重。
原模型不再作为仓库备份或回退选项；Framegen 运行时依赖保留，但不嵌入其自带权重。
自训模型须保持 runtime 对应的网络结构、张量名称、权重布局和 manifest 格式；
仅替换任意 `.bin` 文件不能保证兼容。转换与未验证事项见 [模型说明](../packages/xmax-sdk/models/README.md)。
