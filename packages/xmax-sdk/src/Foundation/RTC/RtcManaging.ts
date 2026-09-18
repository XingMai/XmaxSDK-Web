import type { CameraPosition } from "../Media/Camera/CameraPosition";

/** 摄像头采集参数。 */
export interface RtcCameraCaptureOptions {
  /** 期望的采集宽度（按模型规则调整后的尺寸）。 */
  width: number;

  /** 期望的采集高度。 */
  height: number;

  /** 期望的采集帧率。 */
  frameRate: number;

  /** 首次启动时使用的摄像头位置。 */
  position: CameraPosition;
}

/**
 * 定义 RTC 引擎生命周期与媒体传输能力。
 *
 * 采集由 TRTC 内部完成（`startLocalVideo`）：SDK 不直接调用
 * getUserMedia，浏览器兼容性差异由 TRTC 适配。采集阶段不发布
 * （`publish: false`），建立连接时才发布本地流。
 */
export interface RtcManaging {
  /** RTC 引擎是否已初始化。 */
  readonly isInitialized: boolean;

  /** 初始化 RTC 引擎（不需要凭证，可在本地预览阶段调用）。 */
  initialize(): Promise<void>;

  /** 销毁 RTC 引擎并释放资源。 */
  destroy(): Promise<void>;

  /**
   * 启动摄像头采集（不发布）。
   *
   * @returns 采集到的视频轨。
   * @throws 引擎未初始化、设备不可用或权限被拒绝时抛出错误。
   */
  startCameraCapture(options: RtcCameraCaptureOptions): Promise<MediaStreamTrack>;

  /**
   * 在前置和后置摄像头之间切换。
   *
   * @returns 切换后的视频轨。
   * @throws 采集未启动或设备切换失败时抛出错误。
   */
  switchCameraCapture(to: CameraPosition): Promise<MediaStreamTrack>;

  /** 停止摄像头采集。 */
  stopCameraCapture(): Promise<void>;
}
