import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RealtimeSessionConnection } from "../../Service/Realtime/RealtimeSessionConnection";
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
   * @throws 已有房间未离开、操作失效或进房失败时抛出错误。
   */
  join(
    connection: RealtimeSessionConnection,
    ensureActive: () => void,
  ): Promise<void>;

  /**
   * 停止房间心跳并离开当前 RTC 房间。
   */
  leave(): Promise<void>;

  /**
   * 发送生成开始信令。
   *
   * @throws 房间未就绪或信令发送失败时抛出错误。
   */
  startGeneration(options: {
    taskID: string;
    videoFormat: RealtimeVideoFormat;
    targetSize?: RoomEventTargetSize;
    context: RealtimeContext;
  }): void;

  /**
   * 发送生成条件变更信令。
   *
   * @throws 房间未就绪或信令发送失败时抛出错误。
   */
  changeGenerationCondition(options: {
    taskID: string;
    videoFormat: RealtimeVideoFormat;
    targetSize?: RoomEventTargetSize;
    context: RealtimeContext;
  }): void;

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
  }): void;

  /**
   * 尝试发送生成停止信令；未进房或任务标识为空时忽略。
   */
  stopGeneration(taskID: string): void;

  /**
   * 发送生成任务的交互轨迹；任务标识或轨迹为空时忽略。
   */
  sendTracks(taskID: string, points: RealtimePoint[]): void;

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
