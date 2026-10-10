import type { IAgoraRTCClient, NetworkQuality } from "agora-rtc-sdk-ng";
import { XmaxLogger, XmaxLoggerOption } from "../../Logging/XmaxLogger";
import type { RtcEventListener } from "../RtcEventListener";
import type { NetworkQualityLevel } from "../NetworkStatistics";

/**
 * 将声网统计转换为 SDK 公共单位，保留厂商缺失指标，不推算播放缓冲延迟。
 */
export class AgoraRtcStatistics {
  /**
   * 采集已发布的视频和已订阅的结果流统计，性能日志不控制回调采集。
   */
  static collect(client: IAgoraRTCClient, listener?: RtcEventListener): void {
    const rtc = client.getRTCStats();
    const local = client.getLocalVideoStats();
    const valid = AgoraRtcStatistics.valid;
    const loss = AgoraRtcStatistics.loss;
    const localVideo = client.localTracks.some(track => track.trackMediaType === "video") ? {
      width: valid(local.sendResolutionWidth, 1), height: valid(local.sendResolutionHeight, 1),
      frameRate: valid(local.sendFrameRate), bitrateKbps: valid(local.sendBitrate / 1000),
      uplinkLossPercent: loss(local.currentPacketLossRate),
    } : undefined;
    const remote = Object.entries(client.getRemoteVideoStats()).map(([userID, stats]) => ({
      userID, width: valid(stats.receiveResolutionWidth, 1), height: valid(stats.receiveResolutionHeight, 1),
      frameRate: valid(stats.receiveFrameRate), bitrateKbps: valid(stats.receiveBitrate / 1000),
      rttMs: valid(rtc.RTT), uplinkLossPercent: localVideo?.uplinkLossPercent,
      downlinkLossPercent: loss(stats.currentPacketLossRate), endToEndDelayMs: valid(stats.end2EndDelay),
    }));
    listener?.onLocalVideoStatistics?.(localVideo && Object.freeze(localVideo));
    listener?.onRemoteVideoStatistics?.(Object.freeze(remote.map(item => Object.freeze(item))));

    XmaxLogger.rtc.info(() => `Agora 运行统计 (Agora RTC Statistics)\n${JSON.stringify({
      rttMs: valid(rtc.RTT), sentBytes: valid(rtc.SendBytes), receivedBytes: valid(rtc.RecvBytes), localVideo, remoteVideo: remote,
      capture: { width: valid(local.captureResolutionWidth, 1), height: valid(local.captureResolutionHeight, 1),
        frameRate: valid(local.captureFrameRate) },
      localAudio: client.getLocalAudioStats(), remoteAudio: client.getRemoteAudioStats(),
    }, null, 2)}`, XmaxLoggerOption.performance);
  }

  /**
   * 网络质量等级范围与公共枚举一致；不将整体 RTT 冒充上下行独立 RTT。
   */
  static network(stats: NetworkQuality, listener?: RtcEventListener): void {
    const quality = (value: number): NetworkQualityLevel | undefined =>
      Number.isInteger(value) && value >= 0 && value <= 6 ? value as NetworkQualityLevel : undefined;
    const result = Object.freeze({ uplinkQuality: quality(stats.uplinkNetworkQuality), downlinkQuality: quality(stats.downlinkNetworkQuality) });
    listener?.onNetworkStatistics?.(result);
    XmaxLogger.rtc.info(() => `Agora 网络质量 (Agora Network Quality)\n${JSON.stringify(result, null, 2)}`, XmaxLoggerOption.performance);
  }

  /**
   * 过滤缺失、非有限或不合理的统计值。
   */
  private static valid(value: number | undefined, minimum = 0): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : undefined;
  }

  /**
   * 声网丢包率为 0–1 比例，转换为公共百分比。
   */
  private static loss(value: number): number | undefined {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value * 100 : undefined;
  }
}
