import type { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type {
  RealtimeState,
  RealtimeStateListener,
} from "../../Service/Realtime/RealtimeState";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RealtimeConfiguration } from "./RealtimeConfiguration";

/**
 * 定义 SDK 对接入方提供的实时媒体与生成控制能力。
 *
 * M1 范围：摄像头本地管线（创建/停止/切换、状态监听、关闭）。
 * 连接与生成方法已定义，M2 接入 TRTC 后生效。
 */
export interface XmaxRealtimeManaging {
  /** 实时能力配置。 */
  readonly options: RealtimeConfiguration;

  /** 当前实时连接与生成状态。 */
  readonly currentState: RealtimeState;

  /** 当前本地媒体预览音量，取值范围为 `0...1`。 */
  readonly localAudioVolume: number;

  /** 当前远端生成音频播放音量，取值范围为 `0...1`。 */
  readonly remoteAudioVolume: number;

  /**
   * 设置实时状态监听器。
   * @param listener 实时状态回调；传入 `undefined` 时清除监听器。
   */
  setStateListener(listener?: RealtimeStateListener): Promise<void>;

  /**
   * 设置本地媒体预览音量。
   * @throws 音量超出有效范围时抛出错误。
   */
  setLocalAudioVolume(volume: number): Promise<void>;

  /**
   * 设置远端生成音频播放音量。
   * 尚未连接或订阅远端流时保存配置，并在远端音频开始播放前应用。
   * @throws 音量超出有效范围或 RTC 音量配置失败时抛出错误。
   */
  setRemoteAudioVolume(volume: number): Promise<void>;

  /**
   * 创建本地相机流并开始预览。
   *
   * 将返回的轨道绑定到预览视图；收到有效帧且视图已绑定后进入 `ready`。
   *
   * @returns 包含本地相机视频轨道的媒体流。
   * @throws 模型不支持相机输入、配置无效、权限或采集启动失败时抛出错误。
   */
  createLocalCameraStream(options: {
    videoFormat: RealtimeVideoFormat;
    position: CameraPosition;
    useMicrophone: boolean;
  }): Promise<RealtimeMediaStream>;

  /** 停止本地相机流并释放本地预览与 RTC 资源。 */
  stopLocalCameraStream(): Promise<void>;

  /**
   * 切换前后置摄像头。
   *
   * 生成过程中调用时，SDK 会停止当前生成、切换摄像头，并使用缓存的生成
   * 条件恢复生成；RTC 连接保持不变。连接或生成正在启动时不可切换。
   *
   * @returns 复用原视频轨道并更新摄像头位置后的本地媒体流。
   */
  switchCamera(): Promise<RealtimeMediaStream>;

  /**
   * 使用当前 Manager 创建的本地流建立实时连接。
   * （M2 接入 TRTC 后生效。）
   */
  connect(localStream: RealtimeMediaStream): Promise<RealtimeMediaStream>;

  /** 断开实时连接并保留当前本地媒体预览。 */
  disconnect(): Promise<void>;

  /**
   * 关闭当前实时生命周期并释放连接、本地媒体和 RTC Engine。
   * 关闭期间重复调用会等待同一个释放任务；关闭完成后仍可重新创建本地流。
   */
  close(): Promise<void>;

  /**
   * 按需建立连接并开始生成。
   * （M2 接入 TRTC 后生效。）
   */
  startGeneration(options: {
    localStream: RealtimeMediaStream;
    context: RealtimeContext;
  }): Promise<RealtimeMediaStream>;
}
