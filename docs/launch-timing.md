# 实时启动耗时

SDK 通过 `setLaunchTimingListener` 输出 `RealtimeLaunchTiming` 完整快照，页面只负责展示。
在打开摄像头前注册监听：

```ts
await realtime.setLaunchTimingListener((timing) => {
  // React 示例：setLaunchTiming(timing)
  console.log(timing);
});
```

| 字段 | 计时范围 |
| --- | --- |
| `cameraMs` | 开始打开摄像头 → 相机流创建完成，包含权限等待 |
| `connectionMs` | 开始创建会话 → RTC 进房并发布本地流完成，包含编码配置 |
| `firstFrameMs` | 开始发送生成信令 → SDK 远端视频视图首次呈现帧 |
| `totalMs` | 开始打开摄像头 → SDK 远端视频视图首次呈现帧 |

所有数值均为 `performance.now()` 计算的毫秒值，保留小数，展示时可四舍五入。
`undefined` 表示尚未完成，建议显示 `—`；`0` 是有效耗时。
总耗时独立测量，包含阶段之间的等待，因此不一定等于前三项相加。
先预览后手动生成时，预览期间的等待也计入总耗时。

设置监听器时立即回放当前快照；新一轮 `createLocalCameraStream` 执行时回调空快照，
每完成一个阶段再回调一次。更新 prompt 不重置统计，重复首帧不覆盖结果。
失败、停止相机、断开或关闭后冻结已完成的数据，取消未完成的计时；
需重新打开摄像头才开始下一轮统计，仅在原本地流上重连不另计一轮。
错误原因继续使用现有状态监听接口获取。

首帧由 `XmaxVideoView`（或 `XmaxRealtimeVideoView`、对应 React 组件）通知 SDK，
优先使用 `requestVideoFrameCallback`，不支持时用 `playing` 事件近似判断。
应在 `startGeneration()` 返回后将远端轨道绑定到视图；调用方也可先 `connect()`
取得占位远端轨道并提前绑定，再调用 `startGeneration()`。
该统计不阻塞 `startGeneration()` 返回。仅有生成确认、轨道 unmute 或等待超时
均不会提交首帧统计；未绑定 SDK 远端视图时，首帧和总耗时保持未完成。

传入 `undefined` 取消监听：

```ts
await realtime.setLaunchTimingListener(undefined);
```

回调收到的是不可变快照；同步抛错或异步拒绝不会影响采集与生成。
