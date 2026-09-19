import type { RealtimeModel } from "./RealtimeModel";
import type {
  RealtimeSessionHeartbeatFailureHandler,
  RealtimeSessionHeartbeatRefreshHandler,
} from "./RealtimeSessionConnection";
import type { RealtimeSession } from "./RealtimeSession";

/** 实时会话心跳回调集合。 */
export interface RealtimeSessionHeartbeatHandlers {
  /** 心跳失败或会话失效时调用（一次性，触发后心跳停止）。 */
  onFailure: RealtimeSessionHeartbeatFailureHandler;

  /** 心跳成功后调用，携带包含最新 RTC 凭据的会话数据。 */
  onRefresh?: RealtimeSessionHeartbeatRefreshHandler;
}

/**
 * 定义实时会话 API 与心跳生命周期能力。
 */
export interface RealtimeSessionServicing {
  /**
   * 创建实时会话并返回 RTC 连接信息。
   *
   * @param model 实时生成模型。
   * @returns 包含 RTC 连接参数的会话。
   * @throws 网络失败或响应缺少完整 RTC 连接参数时抛出错误。
   */
  createSession(model: RealtimeModel): Promise<RealtimeSession>;

  /**
   * 启动指定会话的周期心跳；重复启动会替换当前心跳。
   *
   * @param sessionID 会话标识。
   * @param handlers 心跳失败与凭据刷新回调。
   */
  startHeartbeat(
    sessionID: string,
    handlers: RealtimeSessionHeartbeatHandlers,
  ): void;

  /** 停止当前心跳；已经失效的迟到结果不会再触发回调。 */
  stopHeartbeat(): void;

  /**
   * 关闭指定实时会话。
   *
   * @param sessionID 会话标识。
   */
  closeSession(sessionID: string): Promise<void>;
}
