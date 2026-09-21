import type { NetworkQuality, TRTCStatistics } from "trtc-sdk-v5";
import { XmaxLogger, XmaxLoggerOption } from "../Logging/XmaxLogger";

// TRTC 5.20 的类型声明尚未包含运行时可能提供的 point2pointDelay。
interface PlaybackStats {
  jitterBufferDelay?: number;
  point2pointDelay?: number;
}

type AudioStats = TRTCStatistics["localStatistics"]["audio"] & PlaybackStats;
type VideoStats = TRTCStatistics["localStatistics"]["video"][number] & PlaybackStats;

/** 将 TRTC 运行统计按 performance 开关输出到默认可见的 console.info。 @internal */
export class RtcStatsLogger {
  static logStatistics(stats: TRTCStatistics): void {
    XmaxLogger.rtc.info(() => {
      const blocks = [this.block("RTC 运行统计 (RTC Statistics)", [
        `RTT: ${this.value(stats.rtt, "ms")}`,
        `${XmaxLogger.localized("上行丢包率：", "Uplink Packet Loss: ")}${this.value(stats.upLoss, "%")}`,
        `${XmaxLogger.localized("下行丢包率：", "Downlink Packet Loss: ")}${this.value(stats.downLoss, "%")}`,
        `${XmaxLogger.localized("累计发送：", "Bytes Sent: ")}${this.value(stats.bytesSent, "bytes")}`,
        `${XmaxLogger.localized("累计接收：", "Bytes Received: ")}${this.value(stats.bytesReceived, "bytes")}`,
      ])];
      const local = stats.localStatistics;
      if (local?.audio) {
        blocks.push(this.audioBlock("本地音频发送 (Local Audio Uplink)", local.audio, false));
      }
      for (const video of local?.video ?? []) {
        blocks.push(this.videoBlock("本地视频发送 (Local Video Uplink)", video, false));
      }
      for (const remote of stats.remoteStatistics ?? []) {
        // 只输出白名单指标和用户标识，不序列化原始负载。
        const user = remote.userId.replace(/[\r\n]/g, " ");
        if (remote.audio) {
          blocks.push(this.audioBlock(`远端音频接收 (Remote Audio Downlink) [${user}]`, remote.audio, true));
        }
        for (const video of remote.video ?? []) {
          blocks.push(this.videoBlock(`远端视频接收 (Remote Video Downlink) [${user}]`, video, true));
        }
      }
      return blocks.join("\n\n");
    }, XmaxLoggerOption.performance);
  }

  static logNetworkQuality(stats: NetworkQuality): void {
    XmaxLogger.rtc.info(() => this.block("网络质量 (Network Quality Metrics)", [
      `${XmaxLogger.localized("本地上行：", "Local Uplink: ")}${this.quality(stats.uplinkNetworkQuality)}, RTT ${this.value(stats.uplinkRTT, "ms")}, ${XmaxLogger.localized("丢包率 ", "Loss ")}${this.value(stats.uplinkLoss, "%")}`,
      `${XmaxLogger.localized("本地下行（平均）：", "Local Downlink (Average): ")}${this.quality(stats.downlinkNetworkQuality)}, RTT ${this.value(stats.downlinkRTT, "ms")}, ${XmaxLogger.localized("丢包率 ", "Loss ")}${this.value(stats.downlinkLoss, "%")}`,
    ]), XmaxLoggerOption.performance);
  }

  private static audioBlock(title: string, stats: AudioStats, remote: boolean): string {
    return this.block(title, [
      `${XmaxLogger.localized("码率：", "Bitrate: ")}${this.value(stats.bitrate, "kbps")}`,
      `${XmaxLogger.localized("音量（0–1）：", "Audio Level (0–1): ")}${this.value(stats.audioLevel)}`,
      ...(remote ? this.playbackLines(stats) : []),
    ]);
  }

  private static videoBlock(title: string, stats: VideoStats, remote: boolean): string {
    return this.block(title, [
      `${XmaxLogger.localized("流类型：", "Stream Type: ")}${stats.videoType ?? "—"}`,
      `${XmaxLogger.localized("分辨率：", "Resolution: ")}${this.value(stats.width)} × ${this.value(stats.height)}`,
      `${XmaxLogger.localized("帧率：", "Frame Rate: ")}${this.value(stats.frameRate, "fps")}`,
      `${XmaxLogger.localized("码率：", "Bitrate: ")}${this.value(stats.bitrate, "kbps")}`,
      ...(remote ? this.playbackLines(stats) : []),
    ]);
  }

  private static playbackLines(stats: PlaybackStats): string[] {
    return [
      `${XmaxLogger.localized("播放缓冲延迟：", "Jitter Buffer Delay: ")}${this.value(stats.jitterBufferDelay, "ms")}`,
      `${XmaxLogger.localized("RTC 端到端延迟（估算）：", "RTC End-to-End Delay (Estimated): ")}${this.value(stats.point2pointDelay, "ms")}`,
    ];
  }

  private static block(title: string, lines: string[]): string {
    return [title, ...lines.map((line, index) => `${index === lines.length - 1 ? "└─" : "├─"} ${line}`)].join("\n");
  }

  /** TRTC 丢包率已是百分数，无需像 iOS 火山的 ratio 再乘 100。 */
  private static value(value: number | undefined, unit = ""): string {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return "—";
    }
    return `${Number(value.toFixed(2))}${unit ? `${unit === "%" ? "" : " "}${unit}` : ""}`;
  }

  private static quality(value: number): string {
    const names = [
      ["未知", "Unknown"],
      ["极好", "Excellent"],
      ["良好", "Good"],
      ["一般", "Fair"],
      ["差", "Poor"],
      ["极差", "Very Poor"],
      ["断网", "Disconnected"],
    ] as const;
    const name = names[value] ?? names[0];
    return XmaxLogger.localized(name[0], name[1]);
  }
}
