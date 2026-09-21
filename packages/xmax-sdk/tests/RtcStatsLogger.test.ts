import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkQuality, TRTCStatistics, TRTCVideoType } from "trtc-sdk-v5";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";
import { RtcStatsLogger } from "../src/Foundation/RTC/RtcStatsLogger";
import { XmaxEnvironment } from "../src/Foundation/Runtime/XmaxEnvironment";

function statistics(): TRTCStatistics {
  const video = {
    width: 1920, height: 1024, frameRate: 30, bitrate: 4200,
    videoType: "big" as TRTCVideoType,
  };
  return {
    rtt: 32.126, upLoss: 1.25, downLoss: 0, bytesSent: 1000, bytesReceived: 2000,
    localStatistics: { audio: { bitrate: 32, audioLevel: 0.5 }, video: [video] },
    remoteStatistics: [{
      userId: "bot-1",
      audio: { bitrate: 48, audioLevel: 0.25, jitterBufferDelay: 12 },
      video: [{ ...video, jitterBufferDelay: 20 }],
    }],
  };
}

describe("RtcStatsLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    XmaxLogger.configure(XmaxLoggerOption.performance);
  });

  afterEach(() => {
    XmaxLogger.configure(XmaxLoggerOption.none);
    vi.restoreAllMocks();
  });

  it("logs network and media units without scaling TRTC percentages or exposing raw payloads", () => {
    const stats = statistics();
    Object.assign(stats, { token: "must-not-log", authorization: "secret" });
    Object.assign(stats.remoteStatistics[0]!.video[0]!, { point2pointDelay: 180 });
    RtcStatsLogger.logStatistics(stats);
    expect(console.info).toHaveBeenCalledTimes(1);
    const message = vi.mocked(console.info).mock.calls[0]![0] as string;
    expect(message).toContain("[Xmax][RTC]");
    expect(message).toContain("RTT: 32.13 ms");
    expect(message).toContain("上行丢包率：1.25%");
    expect(message).toContain("下行丢包率：0%");
    expect(message).toContain("Local Audio Uplink");
    expect(message).toContain("Local Video Uplink");
    expect(message).toContain("Remote Video Downlink) [bot-1]");
    expect(message).toContain("1920 × 1024");
    expect(message).toContain("30 fps");
    expect(message).toContain("4200 kbps");
    expect(message).toContain("播放缓冲延迟：20 ms");
    expect(message).toContain("RTC 端到端延迟（估算）：180 ms");
    expect(message).not.toContain("must-not-log");
    expect(message).not.toContain("secret");
  });

  it("shows unavailable metrics as a dash and retains valid zero values", () => {
    const stats = statistics();
    stats.rtt = NaN;
    stats.localStatistics.video[0]!.frameRate = Infinity;
    stats.remoteStatistics[0]!.video[0]!.jitterBufferDelay = -1;
    Object.assign(stats.remoteStatistics[0]!.audio, { point2pointDelay: 0 });
    RtcStatsLogger.logStatistics(stats);
    const message = vi.mocked(console.info).mock.calls[0]![0] as string;
    expect(message).toContain("RTT: —");
    expect(message).toContain("帧率：—");
    expect(message).toContain("播放缓冲延迟：—");
    expect(message).toContain("RTC 端到端延迟（估算）：—");
    expect(message).toContain("RTC 端到端延迟（估算）：0 ms");
    expect(message).not.toMatch(/NaN|Infinity|undefined|-1 ms/);
  });

  it("uses English details for the global environment and logs network quality separately", () => {
    XmaxLogger.configure(XmaxLoggerOption.all, XmaxEnvironment.global);
    RtcStatsLogger.logStatistics(statistics());
    RtcStatsLogger.logNetworkQuality({
      uplinkNetworkQuality: 1, downlinkNetworkQuality: 6,
      uplinkRTT: 10, downlinkRTT: 0, uplinkLoss: 2.5, downlinkLoss: 0,
    });
    expect(console.info).toHaveBeenNthCalledWith(1, expect.stringContaining("Uplink Packet Loss: 1.25%"));
    expect(console.info).toHaveBeenNthCalledWith(2, expect.stringContaining("Local Uplink: Excellent, RTT 10 ms, Loss 2.5%"));
    expect(console.info).toHaveBeenNthCalledWith(2, expect.stringContaining("Local Downlink (Average): Disconnected"));
  });

  it.each([XmaxLoggerOption.none, XmaxLoggerOption.business])("does not format or emit disabled performance logs (%s)", (option) => {
    XmaxLogger.configure(option);
    const unreadable = { get rtt(): number { throw new Error("must not format"); } };
    const quality = { get uplinkNetworkQuality(): NetworkQuality["uplinkNetworkQuality"] { throw new Error("must not format"); } };
    expect(() => RtcStatsLogger.logStatistics(unreadable as TRTCStatistics)).not.toThrow();
    expect(() => RtcStatsLogger.logNetworkQuality(quality as NetworkQuality)).not.toThrow();
    expect(console.info).not.toHaveBeenCalled();
  });
});
