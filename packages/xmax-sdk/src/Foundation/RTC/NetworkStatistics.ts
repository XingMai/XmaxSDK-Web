/**
 * TRTC 网络质量等级：未知、极好、良好、一般、差、极差、断网。
 */
export type NetworkQualityLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * 本端 RTC 连接的网络统计，不依赖远端生成流是否已经到达。
 */
export interface NetworkStatistics {
  readonly uplinkQuality?: NetworkQualityLevel;
  /**
   * 所有下行连接的平均网络质量。
   */
  readonly downlinkQuality?: NetworkQualityLevel;
  /**
   * 上行连接到 TRTC 云端的往返延迟，单位 ms，不是单程延迟。
   */
  readonly uplinkRttMs?: number;
  /**
   * 所有下行连接到 TRTC 云端的平均往返延迟，单位 ms。
   */
  readonly downlinkRttMs?: number;
}

/**
 * undefined 表示尚无采样或连接已清理。
 */
export type NetworkStatisticsListener = (statistics: NetworkStatistics | undefined) => void;
