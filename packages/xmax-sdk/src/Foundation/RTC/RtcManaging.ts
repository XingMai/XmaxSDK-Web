import type { CameraPosition } from "../Media/Camera/CameraPosition";
import type { RtcEventListener } from "./RtcEventListener";
import type { RoomJoinConfiguration } from "./RoomJoinConfiguration";
import type { VideoEncodingConfiguration } from "./VideoEncodingConfiguration";

/**
 * 摄像头采集参数。
 */
export interface RtcCameraCaptureOptions {
  /**
   * 期望的采集宽度（按模型规则调整后的尺寸）。
   */
  width: number;

  /**
   * 期望的采集高度。
   */
  height: number;

  /**
   * 期望的采集帧率。
   */
  frameRate: number;

  /**
   * 首次启动时使用的摄像头位置。
   */
  position: CameraPosition;
}

/**
 * 定义 RTC 引擎生命周期、房间、媒体传输和消息能力。
 *
 * 采集由 TRTC 内部完成（`startLocalVideo`）：SDK 不直接调用
 * getUserMedia，浏览器兼容性差异由 TRTC 适配。采集阶段不发布
 * （`publish: false`），建立连接时才发布本地流。
 */
export interface RtcManaging {
  /**
   * RTC 引擎是否已初始化。
   */
  readonly isInitialized: boolean;

  /**
   * 初始化 RTC 引擎（不需要凭证，可在本地预览阶段调用）。
   */
  initialize(): Promise<void>;

  /**
   * 销毁 RTC 引擎并释放资源。
   */
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

  /**
   * 停止摄像头采集。
   */
  stopCameraCapture(): Promise<void>;

  /**
   * 配置本地视频编码参数。
   *
   * 采集阶段不发布，编码参数只影响发送端，在发布前配置即可生效。
   *
   * @throws 采集未启动或编码参数配置失败时抛出错误。
   */
  configureVideoEncoding(
    configuration: VideoEncodingConfiguration,
  ): Promise<void>;

  /**
   * 加入 RTC 房间。
   *
   * @throws 引擎未初始化、进房参数无效或进房失败时抛出错误。
   */
  joinRoom(configuration: RoomJoinConfiguration): Promise<void>;

  /**
   * 离开当前 RTC 房间；未在房间中时不产生效果。
   */
  leaveRoom(): Promise<void>;

  /**
   * 发布本地视频流。
   *
   * @throws 摄像头采集未启动或发布失败时抛出错误。
   */
  publishLocalVideo(): Promise<void>;

  /**
   * 停止发布本地视频流；采集保持运行，本地预览不受影响。
   */
  unpublishLocalVideo(): Promise<void>;

  /**
   * 发布本地音频流；首次调用时启动麦克风采集。
   *
   * @throws 麦克风权限被拒绝或发布失败时抛出错误。
   */
  publishLocalAudio(): Promise<void>;

  /**
   * 停止发布本地音频流；麦克风采集保持运行。
   */
  unpublishLocalAudio(): Promise<void>;

  /**
   * 更新远端视频主流订阅状态。
   *
   * @returns 订阅成功时返回远端视频轨，供渲染层绑定；取消订阅时返回空。
   * @throws 订阅或停止订阅失败时抛出错误。
   */
  subscribeRemoteVideo(
    userID: string,
    subscribe: boolean,
  ): Promise<MediaStreamTrack | undefined>;

  /**
   * 更新远端音频订阅状态。
   *
   * @throws 操作失败时抛出错误。
   */
  subscribeRemoteAudio(userID: string, subscribe: boolean): Promise<void>;

  /**
   * 设置指定远端用户的音频播放音量。
   *
   * @param volume 音量，取值范围为 `0...100`。
   */
  setRemoteAudioVolume(volume: number, userID: string): void;

  /**
   * 向当前 RTC 房间发送自定义消息（`cmdId = 1`）。
   *
   * @param message UTF-8 文本消息；编码后不得超过 1000 字节。
   * @throws 未在房间中或消息超长时抛出错误。
   */
  sendRoomMessage(message: string): void;

  /**
   * 设置 RTC 事件监听器，传入空值时清除监听器。
   */
  setEventListener(listener?: RtcEventListener): void;
}
