import type { RealtimeSessionConnection } from "./RealtimeSessionConnection";

export interface RealtimeSessionInit {
  /**
   * 会话标识（sessionUid）。
   */
  id: string;

  /**
   * 业务用户标识。
   */
  userID?: string;

  /**
   * 会话状态（如 ACTIVE）。
   */
  status?: string;

  /**
   * RTC 连接参数。
   */
  connection?: RealtimeSessionConnection;

  /**
   * 会话关闭原因。
   */
  closeReason?: string;
}

/**
 * Xmax 实时生成会话。
 */
export class RealtimeSession {
  /**
   * 会话信息
   */
  /**
   * 会话标识（sessionUid）。
   */
  readonly id: string;

  /**
   * 业务用户标识。
   */
  readonly userID?: string;

  /**
   * 运行状态
   */
  /**
   * 会话状态（如 ACTIVE）；响应未携带时为空。
   */
  readonly status?: string;

  /**
   * 会话关闭原因。
   */
  readonly closeReason?: string;

  /**
   * RTC 连接
   */
  /**
   * RTC 连接参数；心跳等响应未携带完整参数时为空。
   */
  readonly connection?: RealtimeSessionConnection;

  /**
   * 创建实时会话。
   *
   * @param init.id 会话标识（sessionUid）。
   * @param init.userID 业务用户标识。
   * @param init.status 会话状态。
   * @param init.connection RTC 连接参数。
   * @param init.closeReason 会话关闭原因。
   */
  constructor(init: RealtimeSessionInit) {
    this.id = init.id;
    this.userID = init.userID;
    this.status = init.status;
    this.connection = init.connection;
    this.closeReason = init.closeReason;
  }
}
