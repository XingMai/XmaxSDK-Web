/**
 * 一次相机启动的耗时快照，单位为毫秒；undefined 表示该阶段尚未完成。
 * 新一轮打开摄像头时重置；失败、关闭或断开后保留已完成的值。
 * 仅预览时不产生首帧和总耗时；预览后手动启动生成的等待计入总耗时。
 */
export interface RealtimeLaunchTiming {
  /** 开始打开摄像头到相机流创建完成（包含权限等待）。 */
  readonly cameraMs?: number;
  /** 开始创建会话到 RTC 进房并发布本地流完成。 */
  readonly connectionMs?: number;
  /** 开始发送生成信令到 SDK 远端视图首次呈现视频帧。 */
  readonly firstFrameMs?: number;
  /** 开始打开摄像头到 SDK 远端视图首次呈现视频帧。 */
  readonly totalMs?: number;
}

/** 阶段完成时提供完整快照；不支持帧回调的浏览器以 playing 近似首帧。 */
export type RealtimeLaunchTimingListener = (timing: RealtimeLaunchTiming) => void;
