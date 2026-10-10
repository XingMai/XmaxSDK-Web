import type { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import type { NetworkStatisticsListener } from "../../Foundation/RTC/NetworkStatistics";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type {
  RealtimeState,
  RealtimeStateListener,
} from "../../Service/Realtime/RealtimeState";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RealtimeConfiguration } from "./RealtimeConfiguration";
import type { RealtimeVideoSampleMethod } from "../../Service/Realtime/RealtimeReferenceVideo";
import type { RealtimeLaunchTimingListener } from "../../Service/Realtime/RealtimeLaunchTiming";
import type { RemoteVideoStatisticsListener, VideoStatisticsListener } from "../../Foundation/RTC/VideoStatistics";

/**
 * 定义 SDK 对接入方提供的实时媒体与生成控制能力。
 */
export interface XmaxRealtimeManaging {
  /**
   * 实时能力配置。
   */
  readonly options: RealtimeConfiguration;

  /**
   * 当前实时连接与生成状态。
   */
  readonly currentState: RealtimeState;

  /**
   * 插帧功能开关；不随首帧等待、跳帧或视图挂载变化，不支持或故障降级时关闭。
   */
  readonly isFrameInterpolationEnabled: boolean;

  /**
   * 切换客户端插帧，不改变回传分辨率或重启任务。不支持时抛错且保留配置。
   */
  setFrameInterpolationEnabled(enabled: boolean): Promise<void>;

  /**
   * 手动升/降一档下行输出尺寸，便于调试 change_target_size；仅支持正在生成的 Agora 会话。
   * 仅改变分辨率，成功发送后同步目标档位与插帧尺寸；自动调档仍保持开启。
   * 到达 L1/L5 边界时不重复发送；发送成功不代表服务端已生效。
   */
  adjustDownlinkQuality(direction: "upgrade" | "downgrade"): Promise<void>;

  /**
   * 当前本地媒体预览音量，取值范围为 `0...1`。
   */
  readonly localAudioVolume: number;

  /**
   * 当前远端生成音频播放音量，取值范围为 `0...1`。
   */
  readonly remoteAudioVolume: number;

  /**
   * 设置实时状态监听器。
   * @param listener 实时状态回调；传入 `undefined` 时清除监听器。
   */
  setStateListener(listener?: RealtimeStateListener): Promise<void>;

  /**
   * 监听 TRTC 上下行网络质量和 RTT；立即回放最新快照，断开后回调 undefined。
   * 独立于日志和远端生成流；传入 undefined 取消监听，监听器异常不影响主流程。
   */
  setNetworkStatisticsListener(listener?: NetworkStatisticsListener): Promise<void>;

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
    /**
     * 是否在发布前等待相机预热（固定 200ms），默认 true；false 跳过等待，不产生预热耗时。
     */
    enableFrameValidation?: boolean;
  }): Promise<RealtimeMediaStream>;

  /**
   * 创建服务端直接读取的 HTTP/HTTPS 网络视频源，不采集或发布本地音视频。
   * 本地预览静音播放一次，独立于服务端进度；创建源不会开始生成。
   * 地址必须可由服务端直接访问，不转发浏览器 Cookie 或自定义鉴权头。
   * @param options.videoFormat 模型输入及生成画面规格，不是上行编码参数。
   * @param options.sampleMethod 服务端采样方式，默认 time。
   * @param options.onFinish 当前任务收到服务端完成消息且生成就绪后调用一次，不代表尾帧已播放完。
   * @throws 地址、格式无效或已有活动媒体源时抛错；close 释放源，disconnect 保留预览。
   */
  createNetworkVideoStream(options: {
    url: string;
    videoFormat: RealtimeVideoFormat;
    sampleMethod?: RealtimeVideoSampleMethod;
    onFinish?: () => void;
  }): Promise<RealtimeMediaStream>;

  /**
   * 从本地 File/Blob 创建文件视频源，支持 TRTC、Agora 和 VeRTC，不访问摄像头或麦克风。
   * 通过 Canvas 等比缩放补黑边，文件音频独立上行，本地预览始终静音。
   * 应从用户点击事件直接调用以解锁播放；创建后停在首帧，startGeneration 时开始播放。
   * @param options.videoFormat 期望的视频规格；尺寸自动匹配最接近宽高比的模型档位，等距时优先横屏。
   * @param options.loop 是否循环播放文件音视频，默认 true。
   * @param options.includeAudio 是否发送文件音频，默认 true；无音轨文件输出静音，false 不创建音频轨。
   * @throws 提供方不支持、文件/格式无效、浏览器无法解码或播放受限时抛错。
   */
  createLocalVideoStream(options: {
    file: Blob;
    videoFormat: RealtimeVideoFormat;
    loop?: boolean;
    includeAudio?: boolean;
  }): Promise<RealtimeMediaStream>;

  /**
   * 更新当前本地流的上行视频格式，立即应用于 RTC 编码器，不重连或重启生成。
   * 传入完整格式；未指定的码率和编码偏好按 RealtimeVideoFormat 默认规则解析。
   * 成功后更新本地轨道的 videoFormat，后续重连继续使用该格式。
   * 模型生成及远端插帧仍使用创建本地流时的格式；此接口不改变生成尺寸。
   * 实际发送规格受设备、浏览器和网络影响，应通过统计回调确认。
   * Agora 上行自适应以本次成功应用的完整格式作为新的 L1 基准，后续五档按比例调整尺寸和帧率。
   *
   * @param videoFormat 本次完整的上行尺寸、帧率和编码配置。
   * @throws 无本地相机或文件视频流、其他操作进行中、参数无效或 RTC 更新失败时抛错。
   */
  updateVideoFormat(videoFormat: RealtimeVideoFormat): Promise<void>;

  /**
   * 试验性上行调帧接口：连接建立后使用，保留最近应用的宽高、码率区间和编码偏好。
   * 成功后更新本地轨道格式，重连沿用；不修改服务端生成或输出规格。
   * 手动调用会重置上行质量样本，并以成功后的完整格式作为新的自适应 L1 基准。
   * 仍会重新提交完整编码配置，不保证 RTC 内部自适应状态不受影响，需用实际统计验证。
   */
  updateVideoFrameRate(fps: number): Promise<void>;

  /**
   * 停止本地相机流并释放本地预览与 RTC 资源。
   */
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
   * 创建实时会话、加入 RTC 房间并启动会话心跳；摄像头源发布本地流，网络视频源仅接收。
   * 启用帧检测时，发布前并行等待相机预热（固定 200ms），避免把黑帧推给 RTC。
   * 返回的远端媒体流在生成开始后承载远端生成画面。
   *
   * @param localStream 由当前 Manager 创建的摄像头、本地文件或网络视频源。
   * @returns 远端生成结果占位的媒体流。
   * @throws 本地流不属于当前 Manager、已有活动连接、会话创建或进房
   * 发布失败时抛出错误；失败时自动释放连接资源并恢复本地预览。
   */
  connect(localStream: RealtimeMediaStream): Promise<RealtimeMediaStream>;

  /**
   * 断开实时连接并保留当前本地媒体预览。
   */
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
   * @param options.localStream 由当前 Manager 创建的摄像头、本地文件或网络视频源。
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
