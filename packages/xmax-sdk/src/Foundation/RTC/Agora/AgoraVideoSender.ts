import type { ILocalVideoTrack } from "agora-rtc-sdk-ng";
import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { XmaxLogger, XmaxLoggerOption } from "../../Logging/XmaxLogger";
import { RtcVideoEncoderPreference, type VideoEncodingConfiguration } from "../VideoEncodingConfiguration";

/** 实验性摄像头发送配置：不修改采集约束，不调用 Agora 的编码配置接口。 */
export class AgoraVideoSender {
  static async apply(track: ILocalVideoTrack, config: VideoEncodingConfiguration, ensureActive: () => void): Promise<void> {
    ensureActive();
    const sender = track.getRTCRtpTransceiver()?.sender;
    if (!sender) throw new XmaxError(XmaxErrorCode.rtcError, "WebRTC video sender is unavailable");
    const capture = sender.track?.getSettings();
    if (!capture?.width || !capture.height) {
      throw new XmaxError(XmaxErrorCode.rtcError, "WebRTC capture dimensions are unavailable");
    }
    // 按实际采集规格计算，不能用上一次发送规格，否则连续降档会重复缩放。
    const scale = Math.max(1, capture.width / config.width, capture.height / config.height);
    const parameters = sender.getParameters();
    if (parameters.encodings?.length !== 1) {
      throw new XmaxError(XmaxErrorCode.rtcError, "Sender-only configuration requires one video encoding");
    }
    const encoding = parameters.encodings[0]!;
    const previous = { ...encoding };
    const previousPreference = parameters.degradationPreference;
    encoding.scaleResolutionDownBy = scale;
    encoding.maxFramerate = config.frameRate;
    encoding.maxBitrate = Math.round(config.maximumBitrate * 1000);
    parameters.degradationPreference = config.encoderPreference === RtcVideoEncoderPreference.maintainFramerate
      ? "maintain-framerate" : "maintain-resolution";
    await sender.setParameters(parameters);
    ensureActive();
    if (track.getRTCRtpTransceiver()?.sender !== sender) {
      throw new XmaxError(XmaxErrorCode.cancelled, "WebRTC video sender changed during configuration");
    }
    const applied = sender.getParameters();
    const actual = applied.encodings?.[0];
    if (!actual || Math.abs((actual.scaleResolutionDownBy ?? 1) - scale) > 0.0001 ||
      actual.maxFramerate !== encoding.maxFramerate || actual.maxBitrate !== encoding.maxBitrate) {
      // 某些浏览器会静默忽略字段；尽力恢复旧发送参数，绝不回退到修改摄像头约束。
      if (actual && applied.encodings.length === 1) {
        for (const key of ["scaleResolutionDownBy", "maxFramerate", "maxBitrate"] as const) {
          if (previous[key] === undefined) delete actual[key];
          else actual[key] = previous[key];
        }
        if (previousPreference === undefined) delete applied.degradationPreference;
        else applied.degradationPreference = previousPreference;
        await sender.setParameters(applied);
      }
      throw new XmaxError(XmaxErrorCode.rtcError, "Browser did not retain WebRTC video sender parameters");
    }
    XmaxLogger.rtc.info(() => `Agora 发送参数实验 (Agora Sender Parameters)\n${JSON.stringify({
      capture: { width: capture.width, height: capture.height, frameRate: capture.frameRate },
      target: { width: config.width, height: config.height, frameRate: config.frameRate },
      scaleResolutionDownBy: actual.scaleResolutionDownBy,
      maxFramerate: actual.maxFramerate,
      maxBitrateKbps: actual.maxBitrate! / 1000,
      minimumBitrateApplied: false,
    }, null, 2)}`, XmaxLoggerOption.performance);
  }
}
