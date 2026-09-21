import type { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type {
  RealtimeState,
  RealtimeStateListener,
} from "../../Service/Realtime/RealtimeState";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RealtimeConfiguration } from "./RealtimeConfiguration";
import type { RealtimeLaunchTimingListener } from "../../Service/Realtime/RealtimeLaunchTiming";
import type { RemoteVideoStatisticsListener, VideoStatisticsListener } from "../../Foundation/RTC/VideoStatistics";

/**
 * 定义 SDK 对接入方提供的实时媒体与生成控制能力。
 */
export interface XmaxRealtimeManaging {
  /** 实时能力配置。 */
  readonly options: RealtimeConfiguration;

  /** 当前实时连接与生成状态。 */
  readonly currentState: RealtimeState;

  /** 插帧功能开关；不随首帧等待、跳帧或视图挂载变化，不支持或故障降级时关闭。 */
  readonly isFrameInterpolationEnabled: boolean;

  /** 切换客户端插帧，不改变回传分辨率或重启任务。不支持时抛错且保留配置。 */
  setFrameInterpolationEnabled(enabled: boolean): Promise<void>;

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
   * 监听启动耗时；立即回放当前快照，每完成一个阶段再次回调。
   * 新一轮打开摄像头时重置；失败或终止后冻结，更新生成条件不重置。
   * 首帧统计需要将远端轨道绑定到 SDK 视频视图，且不会阻塞 startGeneration。
   * 传入 undefined 清除监听器；监听器异常不影响生成流程。
   */
  setLaunchTimingListener(listener?: RealtimeLaunchTimingListener): Promise<void>;

  /**
   * 监听本地主视频流实际分辨率、帧率及码率（kbps），独立于日志开关。
   * 设置后立即回放最新快照；未取得数据或停止/断开时回调 undefined。
   * 传入 undefined 取消监听；监听器异常不影响生成流程。
   */
  setLocalVideoStatisticsListener(listener?: VideoStatisticsListener): Promise<void>;

  /**
   * 监听当前生成结果流的分辨率、帧率、码率、云端 RTT 和媒体 E2E 估算值。
   * 独立于日志开关；立即回放最新快照，流消失或断开时回调 undefined。
   * 传入 undefined 取消监听；监听器异常不影响生成流程。
   */
  setRemoteVideoStatisticsListener(listener?: RemoteVideoStatisticsListener): Promise<void>;

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
   *
   * 创建实时会话、加入 RTC 房间并发布本地流，成功后启动会话心跳。
   * 返回的远端媒体流在生成开始后承载远端生成画面。
   *
   * @param localStream 由 `createLocalCameraStream` 创建的本地媒体流。
   * @returns 远端生成结果占位的媒体流。
   * @throws 本地流不属于当前 Manager、已有活动连接、会话创建或进房
   * 发布失败时抛出错误；失败时自动释放连接资源并恢复本地预览。
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
   *
   * 尚未连接时先建立实时连接；已在生成时仅更新生成条件，不重启生成。
   * 首次生成必须提供条件上下文，之后缺省时复用最近一次缓存的上下文。
   *
   * @param options.localStream 由 `createLocalCameraStream` 创建的本地媒体流。
   * @param options.context 本次生成使用的条件上下文；缺省时复用缓存。
   * @returns 承载远端生成画面的媒体流。
   * @throws 本地流不属于当前 Manager、缺少可用的条件上下文、信令发送
   * 或生成确认失败时抛出错误；失败时自动停止生成任务并释放连接资源。
   */
  startGeneration(options: {
    localStream: RealtimeMediaStream;
    context?: RealtimeContext;
  }): Promise<RealtimeMediaStream>;
}
