/**
 * RTC 视频编码策略偏好。
 */
export enum RtcVideoEncoderPreference {
  /**
   * 优先保障帧率（弱网降分辨率）。
   */
  maintainFramerate = "maintainFramerate",

  /**
   * 优先保障分辨率（弱网降帧率）。
   */
  maintainQuality = "maintainQuality",
}

/**
 * 下发给 RTC 引擎的视频编码参数。
 *
 * TRTC 只接受单一目标码率：以 `minimumBitrate`（流畅优先档）作为目标码率，
 * `maximumBitrate` 仅用于上层码率区间校验，不下发给引擎。
 */
export interface VideoEncodingConfiguration {
  /**
   * 编码宽度，单位为像素。
   */
  width: number;

  /**
   * 编码高度，单位为像素。
   */
  height: number;

  /**
   * 编码帧率。
   */
  frameRate: number;

  /**
   * 最低上传码率，单位为 kbps；TRTC 用作目标码率，Agora 用作下限，VeRTC 不提供下限配置。
   */
  minimumBitrate: number;

  /**
   * 最高上传码率，单位为 kbps；Agora 与 VeRTC 用作上限，TRTC 仅参与区间校验。
   */
  maximumBitrate: number;

  /**
   * 编码策略偏好。
   */
  encoderPreference: RtcVideoEncoderPreference;
}
