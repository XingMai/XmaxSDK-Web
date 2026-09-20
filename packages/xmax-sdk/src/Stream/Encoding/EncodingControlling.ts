import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";

/**
 * 定义按实时视频格式配置 RTC 视频编码参数的能力。
 */
export interface EncodingControlling {
  /**
   * 按视频格式配置 RTC 视频编码参数。
   *
   * @throws 格式无效、码率区间无效或 RTC 配置失败时抛出错误。
   */
  configure(videoFormat: RealtimeVideoFormat): Promise<void>;
}
