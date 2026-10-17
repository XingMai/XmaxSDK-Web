import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeExtraParams } from "../../Service/Realtime/RealtimeExtraParams";
import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RtcSessionConnection } from "../../Service/Realtime/RealtimeSessionConnection";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RoomEventTargetSize } from "./RoomEvent";

/**
 * 接收房间业务消息。
 */
export interface RoomListener {
  /**
   * 处理完整房间业务消息（已完成分片组包与目标用户过滤）。
   */
  onRoomMessage(senderUserID: string, message: Record<string, unknown>): void;
}

/**
 * 定义 RTC 房间生命周期和业务信令发送能力。
 */
export interface RoomControlling {
  /**
   * 加入实时房间，并在异步边界前后确认连接操作仍然有效。
   *
   * @param connection 会话下发的 RTC 连接参数。
   * @param ensureActive 确认当前连接操作仍有效的检查；失效时抛出错误。
   * @param measureRtcJoin 开始进房计时，返回成功进房时调用的完成回调。
   * @throws 已有房间未离开、操作失效或进房失败时抛出错误。
   */
  join(
    connection: RtcSessionConnection,
    ensureActive: () => void,
    measureRtcJoin?: () => () => void,
  ): Promise<void>;

  /**
   * 停止房间心跳并离开当前 RTC 房间。
   */
  leave(): Promise<void>;

  /**
   * 发送生成开始信令。
   *
   * @param options.taskID 当前生成任务标识。
   * @param options.videoFormat 模型生成使用的视频规格。
   * @param options.context 本次生成条件。
   * @param options.targetSize 回传尺寸，缺省时不发送；网络视频默认使用生成尺寸。
   * @param options.mirror 是否由后端镜像输入画面，默认 false。
   * @param options.faceRestoration 是否回贴原始人脸，默认 false。
   * @param options.extraParams 合并到本次 start 的 params，不缓存。
   * @throws 房间未就绪或信令发送失败时抛出错误。
   */
  startGeneration(options: {
    taskID: string;
    videoFormat: RealtimeVideoFormat;
    context: RealtimeContext;
    targetSize?: RoomEventTargetSize;
    mirror?: boolean;
    faceRestoration?: boolean;
    extraParams?: RealtimeExtraParams;
  }): Promise<void>;

  /**
   * 发送生成条件变更信令。
   *
   * @param options.taskID 当前生成任务标识。
   * @param options.videoFormat 模型生成使用的视频规格。
   * @param options.context 本次生成条件。
   * @param options.targetSize 服务端生成后的回传尺寸，缺省时不发送。
   * @param options.faceRestoration 是否回贴原始人脸，默认 false。
   * @param options.extraParams 合并到本次 change_condition 的 params，不缓存。
   * @throws 房间未就绪或信令发送失败时抛出错误。
   */
  changeGenerationCondition(options: {
    taskID: string;
    videoFormat: RealtimeVideoFormat;
    context: RealtimeContext;
    targetSize?: RoomEventTargetSize;
    faceRestoration?: boolean;
    extraParams?: RealtimeExtraParams;
  }): Promise<void>;

  /**
   * 调整当前生成任务的回传尺寸。
   *
   * @param options.ensureActive 发送前确认当前配置操作仍有效。
   * @throws 操作已取消、房间未就绪或信令发送失败时抛出错误。
   */
  changeTargetSize(options: {
    taskID: string;
    targetSize: RoomEventTargetSize;
    ensureActive: () => void;
  }): Promise<void>;

  /**
   * 尝试发送生成停止信令；未进房或任务标识为空时忽略。
   */
  stopGeneration(taskID: string): Promise<void>;

  /**
   * 发送生成任务的交互轨迹；任务标识或轨迹为空时忽略。
   */
  sendTracks(taskID: string, points: RealtimePoint[]): Promise<void>;

  /**
   * 设置房间事件监听器，传入空值时清除监听器。
   */
  setListener(listener?: RoomListener): void;

  /**
   * 处理 RTC 层桥接的入站自定义消息：分片组包、目标过滤后分发给监听器。
   * 由持有 RTC 事件监听权的传输层组件调用。
   */
  handleIncomingMessage(senderUserID: string, rawMessage: string): void;
}
