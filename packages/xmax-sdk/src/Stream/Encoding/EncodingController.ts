import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import {
  RtcVideoEncoderPreference,
} from "../../Foundation/RTC/VideoEncodingConfiguration";
import {
  RealtimeVideoEncoderPreference,
  type RealtimeVideoFormat,
} from "../../Service/Realtime/RealtimeVideoFormat";
import type { EncodingControlling } from "./EncodingControlling";

/** 码率参考点：像素面积（或帧率）对应的码率，单位为 kbps。 */
interface BitratePoint {
  value: number;
  bitrate: number;
}

/** 码率区间，单位为 kbps。 */
interface BitrateRange {
  minimum: number;
  maximum: number;
}

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
 * 根据官方编码参数参考表，按上传像素面积和帧率插值计算码率范围；
 * 流畅优先推荐值用于最低码率，画质优先推荐值用于最高码率，表外
 * 规格按参考比例外推。格式显式指定码率时以显式值为准。
 */
export class EncodingController implements EncodingControlling {
  // 基础层组件
  private readonly rtcManager: RtcManaging;

  /**
   * 创建编码控制器。
   *
   * @param options.rtcManager RTC 引擎与媒体传输组件。
   */
  constructor(options: { rtcManager: RtcManaging }) {
    this.rtcManager = options.rtcManager;
  }

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
      const bitrates = EncodingController.resolveBitrates(
        videoFormat.width * videoFormat.height,
        videoFormat.fps,
      );
      const maximumBitrate = Math.round(bitrates.maximum);
      if (!Number.isFinite(maximumBitrate)) {
        throw new XmaxError(
          XmaxErrorCode.invalidConfiguration,
          "Realtime video format exceeds the supported bitrate range",
        );
      }
      const defaultMinimum = Math.max(1, Math.trunc(Math.round(bitrates.minimum)));
      const defaultMaximum = Math.max(defaultMinimum + 1, Math.trunc(maximumBitrate));
      minimum = videoFormat.minimumBitrate ?? defaultMinimum;
      maximum = videoFormat.maximumBitrate ?? defaultMaximum;
    }

    if (minimum > maximum) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Minimum bitrate must not exceed maximum bitrate after applying SDK defaults",
      );
    }

    await this.rtcManager.configureVideoEncoding({
      width: videoFormat.width,
      height: videoFormat.height,
      frameRate: videoFormat.fps,
      minimumBitrate: minimum,
      maximumBitrate: maximum,
      encoderPreference: ENCODER_PREFERENCE_MAP[videoFormat.encoderPreference],
    });
  }

  /** 按像素面积与帧率计算码率区间（kbps）：流畅优先为最低，画质优先为最高。 */
  private static resolveBitrates(pixels: number, fps: number): BitrateRange {
    const bitrate15 = EncodingController.interpolate(
      pixels,
      EncodingController.referenceBitratesAt15FPS,
    );
    const first30 = EncodingController.referenceBitratesAt30FPS[0]!;
    let bitrate30: number;
    if (pixels < first30.value) {
      // 小尺寸沿用 15fps 的尺寸曲线，衔接 30fps 的首个参考点。
      const reference15 = EncodingController.interpolate(
        first30.value,
        EncodingController.referenceBitratesAt15FPS,
      );
      bitrate30 = bitrate15 * (first30.bitrate / reference15);
    } else {
      bitrate30 = EncodingController.interpolate(
        pixels,
        EncodingController.referenceBitratesAt30FPS,
      );
    }

    // 10fps 以 640×480 的 400kbps 为参考，沿用 15fps 的尺寸曲线。
    const bitrate10 = bitrate15 * (400 / 500);
    // 60fps 沿用 30fps 的尺寸曲线，分别匹配 1080p 的两列推荐值。
    const minimum60 = bitrate30 * (4780 / 3150);
    const maximum60 = bitrate30 * (6500 / 3150);
    return {
      minimum: EncodingController.interpolate(fps, [
        { value: 10, bitrate: bitrate10 },
        { value: 15, bitrate: bitrate15 },
        { value: 30, bitrate: bitrate30 },
        { value: 60, bitrate: minimum60 },
      ]),
      maximum: EncodingController.interpolate(fps, [
        { value: 10, bitrate: bitrate10 * 2 },
        { value: 15, bitrate: bitrate15 * 2 },
        { value: 30, bitrate: bitrate30 * 2 },
        { value: 60, bitrate: maximum60 },
      ]),
    };
  }

  /** 在相邻参考点间线性插值，表外按最近端点的比例外推。 */
  private static interpolate(value: number, points: BitratePoint[]): number {
    const first = points[0]!;
    if (value <= first.value) {
      return first.bitrate * (value / first.value);
    }
    for (let index = 1; index < points.length; index += 1) {
      const upper = points[index]!;
      if (value <= upper.value) {
        const lower = points[index - 1]!;
        const ratio = (value - lower.value) / (upper.value - lower.value);
        return lower.bitrate + (upper.bitrate - lower.bitrate) * ratio;
      }
    }
    const last = points[points.length - 1]!;
    return last.bitrate * (value / last.value);
  }

  // 流畅优先码率参考，按像素面积升序排列，单位为 kbps。
  private static readonly referenceBitratesAt15FPS: BitratePoint[] = [
    { value: 120 * 120, bitrate: 50 },
    { value: 160 * 120, bitrate: 65 },
    { value: 180 * 180, bitrate: 100 },
    { value: 240 * 180, bitrate: 120 },
    { value: 320 * 180, bitrate: 140 },
    { value: 320 * 240, bitrate: 200 },
    { value: 424 * 240, bitrate: 220 },
    { value: 360 * 360, bitrate: 260 },
    { value: 480 * 360, bitrate: 320 },
    { value: 640 * 360, bitrate: 400 },
    { value: 640 * 480, bitrate: 500 },
    { value: 848 * 480, bitrate: 610 },
    { value: 960 * 720, bitrate: 910 },
    { value: 1280 * 720, bitrate: 1130 },
    { value: 1920 * 1080, bitrate: 2080 },
  ];

  private static readonly referenceBitratesAt30FPS: BitratePoint[] = [
    { value: 360 * 360, bitrate: 400 },
    { value: 480 * 360, bitrate: 490 },
    { value: 640 * 360, bitrate: 600 },
    { value: 640 * 480, bitrate: 750 },
    { value: 848 * 480, bitrate: 930 },
    { value: 960 * 720, bitrate: 1380 },
    { value: 1280 * 720, bitrate: 1710 },
    { value: 1920 * 1080, bitrate: 3150 },
  ];
}
