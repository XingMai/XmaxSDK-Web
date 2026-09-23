import type { XmaxError } from "../../Foundation/Errors/XmaxError";
import type { RealtimeSession } from "./RealtimeSession";

export interface RealtimeSessionConnectionInit {
  /**
   * RTC 提供方标识（当前仅支持 `trtc`）。
   */
  provider: string;

  /**
   * TRTC 房间号（字符串房间号）。
   */
  roomID: string;

  /**
   * TRTC SDKAppID（按字符串处理）。
   */
  sdkAppID: string;

  /**
   * TRTC 登录身份（`rtc_user_id`，不是业务 `user_id`）。
   */
  userID: string;

  /**
   * TRTC 登录签名。
   */
  userSig: string;

  /**
   * TRTC 进房鉴权字段（字符串房间号对应的 privateMapKey）。
   */
  privateMapKey: string;

  /**
   * 房间内生成 Bot 的用户标识，用于匹配远端结果流。
   */
  botID?: string;
}

/**
 * 实时会话对应的 RTC 连接参数（TRTC）。
 *
 * 全部字段来自会话接口 `data.modelExtra`；心跳成功后服务端可能
 * 下发新的 `userSig` / `privateMapKey`，使用方应覆盖本地缓存。
 */
export class RealtimeSessionConnection {
  /**
   * RTC 提供方
   */
  /**
   * RTC 提供方标识（当前仅支持 `trtc`）。
   */
  readonly provider: string;

  /**
   * 进房参数
   */
  /**
   * TRTC 房间号（字符串房间号）。
   */
  readonly roomID: string;

  /**
   * TRTC SDKAppID（按字符串处理）。
   */
  readonly sdkAppID: string;

  /**
   * TRTC 登录身份（`rtc_user_id`，不是业务 `user_id`）。
   */
  readonly userID: string;

  /**
   * TRTC 登录签名。
   */
  readonly userSig: string;

  /**
   * TRTC 进房鉴权字段（字符串房间号对应的 privateMapKey）。
   */
  readonly privateMapKey: string;

  /**
   * 房间成员
   */
  /**
   * 房间内生成 Bot 的用户标识，用于匹配远端结果流。
   */
  readonly botID?: string;

  /**
   * 创建 RTC 连接参数。
   *
   * @param init.provider RTC 提供方标识。
   * @param init.roomID TRTC 房间号。
   * @param init.sdkAppID TRTC SDKAppID。
   * @param init.userID TRTC 登录身份。
   * @param init.userSig TRTC 登录签名。
   * @param init.privateMapKey TRTC 进房鉴权字段。
   * @param init.botID 房间内生成 Bot 的用户标识。
   */
  constructor(init: RealtimeSessionConnectionInit) {
    this.provider = init.provider;
    this.roomID = init.roomID;
    this.sdkAppID = init.sdkAppID;
    this.userID = init.userID;
    this.userSig = init.userSig;
    this.privateMapKey = init.privateMapKey;
    this.botID = init.botID;
  }
}

/**
 * 实时会话心跳失败回调。
 */
export type RealtimeSessionHeartbeatFailureHandler = (
  sessionID: string,
  error: XmaxError,
) => void | Promise<void>;

/**
 * 实时会话心跳刷新回调；心跳成功且会话仍活跃时携带最新会话数据。
 */
export type RealtimeSessionHeartbeatRefreshHandler = (
  session: RealtimeSession,
) => void;
