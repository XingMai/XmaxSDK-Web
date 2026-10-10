/**
 * 单个视频视图最近采样窗口的呈现帧率，不代表屏幕实际刷新帧率。
 */
export interface VideoRenderStatistics {
  /**
   * video 按浏览器 presentedFrames 增量计数；canvas 按实际呈现提交计数。
   */
  readonly source: "video" | "canvas";
  /**
   * 原帧与插值帧的总呈现帧率，单位 fps。
   */
  readonly frameRate: number;
  /**
   * 原帧呈现帧率，单位 fps。
   */
  readonly originalFrameRate: number;
  /**
   * 插值帧呈现帧率，单位 fps；未开启插帧时为 0。
   */
  readonly interpolatedFrameRate: number;
}
