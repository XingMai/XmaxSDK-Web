import type { XmaxError } from "../../Foundation/Errors/XmaxError";
import type { RealtimeSession } from "./RealtimeSession";
import { RoomJoinConfiguration, type RtcRoomJoinConfiguration, type VeRtcRoomJoinConfiguration } from "../../Foundation/RTC/RoomJoinConfiguration";

export interface RealtimeSessionConnectionInit {
  /**
   * TRTC 凭据的提供方判别字段。
   */
  provider: "trtc";

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
 * 凭据来自会话接口 `data.modelExtra`，provider 由接入配置决定；心跳成功后服务端可能
 * 下发新的 `userSig` / `privateMapKey`，使用方应覆盖本地缓存。
 */
export class RealtimeSessionConnection {
  /**
   * RTC 提供方
   */
  /**
   * TRTC 凭据的提供方判别字段。
   */
  readonly provider: "trtc";

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
) => void | Promise<void>;

/**
 * 声网会话凭证；频道与 UID 原样用于 RTC 入房和房间信令。
 */
export interface AgoraSessionConnection {
  /**
   * 提供方与房间身份
   */
  readonly provider: "agora";
  readonly roomID: string;
  readonly appID: string;
  readonly userID: string;
  readonly botID?: string;

  /**
   * RTC 入房与续期凭证，不写入日志。
   */
  readonly roomToken: string;
}

/**
 * RTC 会话连接参数，按 provider 区分厂商凭证。
 */
export interface VeRtcSessionConnection extends VeRtcRoomJoinConfiguration {
  readonly botID?: string;
}

export type RtcSessionConnection = RealtimeSessionConnection | AgoraSessionConnection | VeRtcSessionConnection;

/** provider 由接入配置赋值，只在 SDK 内部区分凭据类型。 */
export function toRoomJoinConfiguration(connection: RtcSessionConnection): RtcRoomJoinConfiguration {
  return connection.provider === "trtc" ? new RoomJoinConfiguration(connection) : connection;
}

export function connectionAppID(connection: RtcSessionConnection): string {
  return connection.provider === "trtc" ? connection.sdkAppID : connection.appID;
}
