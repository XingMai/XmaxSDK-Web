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

  /** 保留已解析的其他编码配置，仅更新帧率，返回成功应用的完整格式。 */
  updateFrameRate(fps: number): Promise<RealtimeVideoFormat>;
}
