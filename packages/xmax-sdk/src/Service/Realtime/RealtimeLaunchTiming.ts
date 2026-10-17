/**
 * 一次相机启动的耗时快照，单位为毫秒；undefined 表示该阶段尚未完成或未启用。
 * 新一轮打开摄像头时重置；失败、关闭或断开后保留已完成的值。
 * 仅预览时不产生首帧和总耗时；预览后手动启动生成的等待计入总耗时。
 */
export interface RealtimeLaunchTiming {
  /**
   * 开始打开摄像头到相机流创建完成（包含权限等待）。
   */
  readonly cameraMs?: number;
  /**
   * 确认相机与麦克风权限可用的耗时；系统弹窗时统计到用户完成授权。
   * 权限被拒绝或浏览器不支持观察时不记录。
   */
  readonly permissionMs?: number;
  /**
   * 创建业务会话的耗时。
   */
  readonly sessionMs?: number;

  /**
   * RTC 适配器进房调用的耗时，不含房间消息配置、心跳启动、预热等待和本地流发布。
   */
  readonly rtcJoinMs?: number;

  /**
   * 发布本地流到 RTC 房间的耗时。
   */
  readonly publishMs?: number;
  /**
   * 开始发送生成信令到远端视频首帧提交合成器，不包含渲染预热。
   */
  readonly firstFrameMs?: number;

  /**
   * 远端首帧就绪到渲染预热结束的实际等待时间，不含渐入动画。
   */
  readonly renderWarmupMs?: number;

  /**
   * 开始打开摄像头到远端渲染预热结束、开始渐入的实际总耗时，并非各项之和。
   */
  readonly totalMs?: number;
}

/**
 * 阶段完成时提供完整快照；不支持帧回调的浏览器以 playing 近似首帧。
 */
export type RealtimeLaunchTimingListener = (timing: RealtimeLaunchTiming) => void;
