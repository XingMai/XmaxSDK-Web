import type { RemoteVideoStatistics, VideoStatisticsListener } from "./VideoStatistics";
import type { NetworkStatisticsListener } from "./NetworkStatistics";

/**
 * 接收 RTC 媒体和数据信令事件。
 *
 * 房间信令走 TRTC 自定义消息、Agora DataStream 或 VeRTC 房间文本消息，不使用 SEI。
 */
export interface RtcEventListener {
  /**
   * RTC 凭据即将过期，请求新凭据进行在线续期。
   */
  onTokenWillExpire?: () => void;

  /**
   * RTC 凭据已经过期，请求新凭据以恢复房间连接。
   */
  onTokenExpired?: () => void;

  /**
   * 原房间正在重新加入；清除旧订阅绑定，但保留当前生成任务与音量配置。
   */
  onRoomRejoining?: () => void;

  /**
   * RTC 运行期错误，不包含鉴权凭据。
   */
  onError?: (error: import("../Errors/XmaxError").XmaxError) => void;
  /**
   * 本端上下行网络质量和 RTT，独立于性能日志开关。
   */
  onNetworkStatistics?: NetworkStatisticsListener;

  /**
   * 本地主视频流运行统计；独立于性能日志开关。
   */
  onLocalVideoStatistics?: VideoStatisticsListener;

  /**
   * 本次采样所有远端主视频流的完整列表，空列表表示当前无可用统计。
   */
  onRemoteVideoStatistics?: (statistics: readonly RemoteVideoStatistics[]) => void;

  /**
   * 处理远端用户的视频发布状态变化（仅主流）。
   */
  onRemoteVideoPublished(userID: string, published: boolean): void;

  /**
   * 处理房间自定义消息（TRTC 已按 `cmdId = 1` 过滤，统一为 UTF-8 文本）。
   */
  onCustomMessageReceived(userID: string, message: string): void;
}
