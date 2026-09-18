/**
 * 接收 RTC 媒体和数据信令事件。
 *
 * Web 端房间信令走 TRTC 自定义消息通道（`cmdId = 1`），
 * 不使用 SEI。
 */
export interface RtcEventListener {
  /** 处理远端用户的视频发布状态变化（仅主流）。 */
  onRemoteVideoPublished(userID: string, published: boolean): void;

  /** 处理房间自定义消息（已按 `cmdId = 1` 过滤并解码为 UTF-8 文本）。 */
  onCustomMessageReceived(userID: string, message: string): void;
}
