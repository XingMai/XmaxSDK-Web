import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";

/**
 * 像素面积或帧率对应的码率参考点，单位为 kbps。
 */
interface BitratePoint {
  value: number;
  bitrate: number;
}

/**
 * 上下行共用的默认码率预算；显式上传码率由编码控制器优先处理。
 */
export class EncodingBitratePolicy {
  /**
   * 最高码率相对参考值的预算系数。
   */
  private static readonly bitrateScale = 0.6;

  /**
   * 最低码率固定为 100 kbps，最高码率按尺寸和帧率计算并应用预算系数。
   */
  static resolve(width: number, height: number, fps: number): { minimum: number; maximum: number } {
    new RealtimeVideoFormat({ width, height, fps }).validate();
    const maximum = Math.round(
      this.resolveMaximumBitrate(width * height, fps) * this.bitrateScale,
    );
    if (!Number.isSafeInteger(maximum)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Realtime video format exceeds the supported bitrate range",
      );
    }

    return { minimum: 100, maximum: Math.max(100, maximum) };
  }

  /**
   * 按像素面积和帧率插值计算最高码率参考值。
   */
  private static resolveMaximumBitrate(pixels: number, fps: number): number {
    const bitrate15 = EncodingBitratePolicy.interpolate(
      pixels,
      EncodingBitratePolicy.referenceBitratesAt15FPS,
    );

    const first30 = EncodingBitratePolicy.referenceBitratesAt30FPS[0]!;
    let bitrate30: number;
    if (pixels < first30.value) {
      // 小尺寸沿用 15fps 的尺寸曲线，衔接 30fps 的首个参考点。
      const reference15 = EncodingBitratePolicy.interpolate(
        first30.value,
        EncodingBitratePolicy.referenceBitratesAt15FPS,
      );
      bitrate30 = bitrate15 * (first30.bitrate / reference15);
    } else {
      bitrate30 = EncodingBitratePolicy.interpolate(
        pixels,
        EncodingBitratePolicy.referenceBitratesAt30FPS,
      );
    }

    // 10fps 以 640×480 的 400kbps 为参考，沿用 15fps 的尺寸曲线。
    const bitrate10 = bitrate15 * (400 / 500);

    // 60fps 沿用 30fps 的尺寸曲线，匹配 1080p 的画质优先参考值。
    const maximum60 = bitrate30 * (6500 / 3150);

    return EncodingBitratePolicy.interpolate(fps, [
      { value: 10, bitrate: bitrate10 * 2 },
      { value: 15, bitrate: bitrate15 * 2 },
      { value: 30, bitrate: bitrate30 * 2 },
      { value: 60, bitrate: maximum60 },
    ]);
  }

  /**
   * 在相邻参考点间线性插值，表外按最近端点的比例外推。
   */
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

  /**
   * 流畅优先码率参考，按像素面积升序排列，单位为 kbps。
   */
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

  /**
   * 30 fps 的像素面积与码率参考点，单位为 kbps。
   */
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
