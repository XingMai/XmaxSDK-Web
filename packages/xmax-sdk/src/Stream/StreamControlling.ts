import type { RemoteStream } from "../Foundation/RTC/RemoteStream";
import type { RemoteVideoStatisticsListener, VideoStatisticsListener } from "../Foundation/RTC/VideoStatistics";
import type { RealtimeContext } from "../Service/Realtime/RealtimeContext";
import type { RealtimePoint } from "../Service/Realtime/RealtimePoint";
import type { RealtimeSessionConnection } from "../Service/Realtime/RealtimeSessionConnection";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import type { RoomListener } from "./Room/RoomControlling";
import type { RoomEventTargetSize } from "./Room/RoomEvent";

/** 远端结果流及其可供渲染层绑定的视频轨。 */
export interface RemoteStreamBinding {
  /** 远端流标识。 */
  stream: RemoteStream;

  /** 远端视频轨。 */
  videoTrack: MediaStreamTrack;
}

/** 远端生成流就绪（携带绑定）与清理（传入空值）回调。 */
export type RemoteStreamListener = (binding: RemoteStreamBinding | null) => void;

/** 生成开始/变更信令的公共参数。 */
export interface StreamGenerationOptions {
  /** 当前生成任务的唯一标识。 */
  taskID: string;

  /** 当前本地媒体使用的视频格式。 */
  videoFormat: RealtimeVideoFormat;

  /** 当前连接的回传尺寸；缺省时保持生成尺寸。 */
  targetSize?: RoomEventTargetSize;

  /** 当前生成任务使用的条件上下文。 */
  context: RealtimeContext;
}

/**
 * 定义传输层向 Core 暴露的统一能力。
 */
export interface StreamControlling {
  /** 当前是否存在正在启动或已经运行的生成任务。 */
  readonly hasGenerationTask: boolean;

  /** 当前远端生成音频播放音量，取值范围为 `0...1`。 */
  readonly remoteAudioVolume: number;

  /**
   * 设置远端生成音频播放音量，并应用到所有已订阅的远端音频。
   *
   * @param volume 音量，取值范围为 `0...1`。
   */
  setRemoteAudioVolume(volume: number): void;

  /**
   * 按视频格式配置本地视频编码参数（码率区间与编码策略）。
   *
   * 采集阶段不发布，编码参数只影响发送端，需在发布本地流之前配置。
   *
   * @throws 格式无效、码率区间无效或 RTC 配置失败时抛出错误。
   */
  setVideoEncoderConfig(videoFormat: RealtimeVideoFormat): Promise<void>;

  /**
   * 加入 RTC 房间并发布本地媒体流。
   *
   * @param connection RTC 房间、用户、凭据和目标机器人信息。
   * @param includeLocalAudio 是否随本地视频一起发布本地音频。
   * @param ensureActive 在异步边界校验当前连接操作仍然有效的回调。
   * @throws 连接已取消，或 RTC 进房、房间配置与本地流发布失败时抛出错误。
   */
  connect(
    connection: RealtimeSessionConnection,
    includeLocalAudio: boolean,
    ensureActive: () => void,
  ): Promise<void>;

  /** 清理生成状态、本地发布和远端订阅，并离开当前 RTC 房间。 */
  disconnect(): Promise<void>;

  /**
   * 建立生成任务并发送开始信令。
   *
   * @returns 等待远端结果流确认的 Promise：机器人视频发布并完成
   * 订阅后兑现；超时、取消或订阅失败时拒绝。
   * @throws 任务标识无效、RTC 房间未就绪、已有生成任务，或开始信令
   * 发送失败时同步抛出错误。
   */
  beginGeneration(options: StreamGenerationOptions): Promise<void>;

  /**
   * 在远端首帧已经可显示后订阅当前生成流的音频。
   *
   * @throws 当前生成流尚未确认，或 RTC 音量和订阅配置失败时抛出错误。
   */
  activateRemoteAudio(): Promise<void>;

  /**
   * 发送生成条件变更信令。
   *
   * @throws RTC 房间未就绪或条件变更信令发送失败时抛出错误。
   */
  updateGeneration(options: StreamGenerationOptions): void;

  /**
   * 调整当前生成任务的回传尺寸，不重启生成。
   *
   * @throws 操作已取消、房间未就绪或信令发送失败时抛出错误。
   */
  changeTargetSize(
    taskID: string,
    targetSize: RoomEventTargetSize,
    ensureActive: () => void,
  ): void;

  /**
   * 停止生成任务并清理远端结果流；任务标识为空字符串时停止当前任务。
   *
   * @throws RTC 停止信令发送失败时抛出错误。
   */
  stopGeneration(taskID: string): Promise<void>;

  /**
   * 发送生成任务的交互轨迹；空数组会被忽略。
   *
   * @throws RTC 房间未就绪或轨迹信令发送失败时抛出错误。
   */
  sendTracks(taskID: string, points: RealtimePoint[]): void;

  /** 设置房间业务消息监听器，传入空值时清除监听器。 */
  setRoomListener(listener?: RoomListener): void;

  /** 设置本地主视频流统计监听器，传入 undefined 清除。 */
  setLocalVideoStatisticsListener(listener?: VideoStatisticsListener): void;

  /** 监听当前实际生成结果流的统计，按已接受的远端用户标识过滤。 */
  setRemoteVideoStatisticsListener(listener?: RemoteVideoStatisticsListener): void;
}
