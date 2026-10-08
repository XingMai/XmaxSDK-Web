export interface RoomJoinConfigurationInit {
  /**
   * TRTC 房间号（字符串房间号）。
   */
  roomID: string;

  /**
   * TRTC 登录身份（`rtc_user_id`）。
   */
  userID: string;

  /**
   * TRTC SDKAppID（字符串形式，进房时转换为数值）。
   */
  sdkAppID: string;

  /**
   * TRTC 登录签名。
   */
  userSig: string;

  /**
   * TRTC 进房鉴权字段（字符串房间号对应的 privateMapKey）。
   */
  privateMapKey: string;
}

/**
 * RTC 房间加入参数。
 */
export class RoomJoinConfiguration {
  /**
   * RTC 提供方。
   */
  readonly provider = "trtc" as const;
  /**
   * 进房参数
   */
  /**
   * TRTC 房间号（字符串房间号）。
   */
  readonly roomID: string;

  /**
   * TRTC 登录身份（`rtc_user_id`）。
   */
  readonly userID: string;

  /**
   * TRTC SDKAppID（字符串形式，进房时转换为数值）。
   */
  readonly sdkAppID: string;

  /**
   * TRTC 登录签名。
   */
  readonly userSig: string;

  /**
   * TRTC 进房鉴权字段（字符串房间号对应的 privateMapKey）。
   */
  readonly privateMapKey: string;

  /**
   * 创建房间加入参数。
   *
   * @param init.roomID TRTC 房间号。
   * @param init.userID TRTC 登录身份。
   * @param init.sdkAppID TRTC SDKAppID（字符串形式）。
   * @param init.userSig TRTC 登录签名。
   * @param init.privateMapKey TRTC 进房鉴权字段。
   */
  constructor(init: RoomJoinConfigurationInit) {
    this.roomID = init.roomID;
    this.userID = init.userID;
    this.sdkAppID = init.sdkAppID;
    this.userSig = init.userSig;
    this.privateMapKey = init.privateMapKey;
  }
}

/**
 * 声网进房参数；App ID、频道、用户和 Token 必须来自同一会话。
 */
export interface AgoraRoomJoinConfiguration {
  readonly provider: "agora";
  readonly roomID: string;
  readonly userID: string;
  readonly appID: string;
  readonly roomToken: string;
}

/**
 * 两种 RTC 的进房参数，不混用不同厂商的鉴权字段。
 */
export interface VeRtcRoomJoinConfiguration {
  readonly provider: "vertc";
  readonly roomID: string;
  readonly userID: string;
  readonly appID: string;
  readonly roomToken: string;
}

export type RtcRoomJoinConfiguration = RoomJoinConfiguration | AgoraRoomJoinConfiguration | VeRtcRoomJoinConfiguration;
