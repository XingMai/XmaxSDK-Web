/** 视频流实际运行统计；缺失或无效指标为 undefined。 */
export interface VideoStatistics {
  readonly width?: number;
  readonly height?: number;
  /** 实际帧率，单位 fps。 */
  readonly frameRate?: number;
  /** 实际码率，单位 kbps。 */
  readonly bitrateKbps?: number;
}

/** undefined 表示当前没有可用统计（尚未发布、断开或停止）。 */
export type VideoStatisticsListener = (statistics: VideoStatistics | undefined) => void;

/** 一路远端主视频流的接收统计。 */
export interface RemoteVideoStatistics extends VideoStatistics {
  readonly userID: string;
  /** 本端 SDK 到 TRTC 云端的往返延迟，单位 ms；不是与远端用户之间的 RTT。 */
  readonly rttMs?: number;
  /** TRTC 媒体端到端延迟估算值，单位 ms；不代表完整 AI 处理链路耗时。 */
  readonly endToEndDelayMs?: number;
}

/** undefined 表示当前结果流没有统计或已被清理。 */
export type RemoteVideoStatisticsListener = (statistics: RemoteVideoStatistics | undefined) => void;
