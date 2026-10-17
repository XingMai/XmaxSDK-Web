import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import {
  RtcVideoEncoderPreference,
  type VideoEncodingConfiguration,
} from "../../Foundation/RTC/VideoEncodingConfiguration";
import {
  RealtimeVideoEncoderPreference,
  RealtimeVideoFormat,
} from "../../Service/Realtime/RealtimeVideoFormat";
import { EncodingBitratePolicy } from "./EncodingBitratePolicy";
import type { EncodingControlling } from "./EncodingControlling";

const ENCODER_PREFERENCE_MAP: Record<
  RealtimeVideoEncoderPreference,
  RtcVideoEncoderPreference
> = {
  [RealtimeVideoEncoderPreference.maintainFramerate]:
    RtcVideoEncoderPreference.maintainFramerate,
  [RealtimeVideoEncoderPreference.maintainQuality]:
    RtcVideoEncoderPreference.maintainQuality,
};

/**
 * 根据实时视频格式配置 RTC 视频编码参数。
 *
 * 默认最低码率为 100 kbps，最高码率由共享预算策略计算。
 * 格式显式指定码率时以显式值为准。
 */
export class EncodingController implements EncodingControlling {
  /**
   * 基础层组件
   */
  private readonly rtcManager: RtcManaging;
  private lastAppliedConfiguration?: VideoEncodingConfiguration;

  /**
   * 创建编码控制器。
   *
   * @param options.rtcManager RTC 引擎与媒体传输组件。
   */
  constructor(options: { rtcManager: RtcManaging }) {
    this.rtcManager = options.rtcManager;
  }

  /**
   * 校验视频格式，解析显式或推荐码率范围后配置 RTC 编码器；参数或配置失败时抛错。
   */
  async configure(videoFormat: RealtimeVideoFormat): Promise<void> {
    videoFormat.validate();

    let minimum: number;
    let maximum: number;
    if (
      videoFormat.minimumBitrate !== undefined &&
      videoFormat.maximumBitrate !== undefined
    ) {
      minimum = videoFormat.minimumBitrate;
      maximum = videoFormat.maximumBitrate;
    } else {
      const defaults = EncodingBitratePolicy.resolve(
        videoFormat.width, videoFormat.height, videoFormat.fps,
      );
      minimum = videoFormat.minimumBitrate ?? defaults.minimum;
      maximum = videoFormat.maximumBitrate ?? defaults.maximum;
    }

    if (minimum > maximum) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Minimum bitrate must not exceed maximum bitrate after applying SDK defaults",
      );
    }

    const configuration: VideoEncodingConfiguration = {
      width: videoFormat.width,
      height: videoFormat.height,
      frameRate: videoFormat.fps,
      minimumBitrate: minimum,
      maximumBitrate: maximum,
      encoderPreference: ENCODER_PREFERENCE_MAP[videoFormat.encoderPreference],
    };
    await this.rtcManager.configureVideoEncoding(configuration);
    this.lastAppliedConfiguration = { ...configuration };
  }

  /** 只替换目标帧率，保留最近成功应用的尺寸、已解析码率区间和偏好。 */
  async updateFrameRate(fps: number): Promise<RealtimeVideoFormat> {
    const previous = this.lastAppliedConfiguration;
    if (!previous) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Apply an encoder configuration before updating frame rate");
    }
    const format = new RealtimeVideoFormat({
      width: previous.width, height: previous.height, fps,
      minimumBitrate: previous.minimumBitrate, maximumBitrate: previous.maximumBitrate,
      encoderPreference: previous.encoderPreference === RtcVideoEncoderPreference.maintainFramerate
        ? RealtimeVideoEncoderPreference.maintainFramerate : RealtimeVideoEncoderPreference.maintainQuality,
    });
    format.validate();
    if (fps !== previous.frameRate) {
      const next = { ...previous, frameRate: fps };
      await this.rtcManager.configureVideoEncoding(next);
      this.lastAppliedConfiguration = next;
    }
    return format;
  }
}
