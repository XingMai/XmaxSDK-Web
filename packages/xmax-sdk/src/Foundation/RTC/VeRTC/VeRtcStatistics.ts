import type { LocalVideoStats, RemoteVideoStats } from "@volcengine/rtc";
import type { VideoStatistics, RemoteVideoStatistics } from "../VideoStatistics";
import type { NetworkQualityLevel } from "../NetworkStatistics";

/** VeRTC 的码率已经是 kbps，丢包率为 0–1；缺失指标不推算。 */
export class VeRtcStatistics {
  static local(stats: LocalVideoStats): VideoStatistics {
    return Object.freeze({
      width: this.valid(stats.encodedFrameWidth, 1), height: this.valid(stats.encodedFrameHeight, 1),
      frameRate: this.valid(stats.sentFrameRate), bitrateKbps: this.valid(stats.sentKBitrate),
      uplinkLossPercent: this.loss(stats.videoLossRate),
    });
  }

  static remote(userID: string, stats: RemoteVideoStats, uplinkLossPercent?: number): RemoteVideoStatistics {
    return Object.freeze({
      userID, width: this.valid(stats.width, 1), height: this.valid(stats.height, 1),
      frameRate: this.valid(stats.decoderOutputFrameRate), bitrateKbps: this.valid(stats.receivedKBitrate),
      rttMs: this.valid(stats.rtt), downlinkLossPercent: this.loss(stats.videoLossRate),
      endToEndDelayMs: this.valid(stats.e2eDelay), uplinkLossPercent,
    });
  }

  static quality(value: number): NetworkQualityLevel | undefined {
    return Number.isInteger(value) && value >= 0 && value <= 6 ? value as NetworkQualityLevel : undefined;
  }

  private static valid(value: number | undefined, minimum = 0): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : undefined;
  }

  private static loss(value: number): number | undefined {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value * 100 : undefined;
  }
}
