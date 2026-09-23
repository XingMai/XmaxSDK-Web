import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * 实时视频的编码策略偏好。
 */
export enum RealtimeVideoEncoderPreference {
  /**
   * 优先保障帧率（弱网降分辨率）。
   */
  maintainFramerate = "maintainFramerate",

  /**
   * 优先保障分辨率（弱网降帧率）。
   */
  maintainQuality = "maintainQuality",
}

export interface RealtimeVideoFormatInit {
  /**
   * 视频宽度，单位为像素。
   */
  width: number;

  /**
   * 视频高度，单位为像素。
   */
  height: number;

  /**
   * 视频帧率，必须大于 0。
   */
  fps: number;

  /**
   * 最低上传码率，单位为 kbps；缺省使用 SDK 默认值，0 表示不设最低码率。
   */
  minimumBitrate?: number;

  /**
   * 最高上传码率，单位为 kbps；缺省使用 SDK 默认值，指定时必须大于 0。
   */
  maximumBitrate?: number;

  /**
   * 上传编码策略偏好，默认优先保障帧率。
   */
  encoderPreference?: RealtimeVideoEncoderPreference;
}

/**
 * 实时视频的尺寸、帧率和上传编码配置。
 */
export class RealtimeVideoFormat {
  /**
   * 视频规格
   */
  /**
   * 视频宽度，单位为像素。
   */
  readonly width: number;
  /**
   * 视频高度，单位为像素。
   */
  readonly height: number;
  /**
   * 视频帧率，单位为 fps。
   */
  readonly fps: number;

  /**
   * 上传编码配置
   */
  /**
   * 最低上传码率，单位为 kbps；未指定时由 SDK 计算，0 表示不设最低码率。
   */
  readonly minimumBitrate?: number;
  /**
   * 最高上传码率，单位为 kbps；未指定时由 SDK 计算。
   */
  readonly maximumBitrate?: number;
  /**
   * 弱网下优先保障帧率或分辨率的编码策略。
   */
  readonly encoderPreference: RealtimeVideoEncoderPreference;

  /**
   * 创建实时视频格式。
   *
   * @param init.width 视频宽度，单位为像素。
   * @param init.height 视频高度，单位为像素。
   * @param init.fps 视频帧率，必须大于 0。
   * @param init.minimumBitrate 最低上传码率，单位为 kbps；缺省按最终上传尺寸和帧率计算。
   * @param init.maximumBitrate 最高上传码率，单位为 kbps；缺省按最终上传尺寸和帧率计算。
   * @param init.encoderPreference 上传编码策略偏好，默认值为 maintainFramerate。
   */
  constructor(init: RealtimeVideoFormatInit) {
    this.width = init.width;
    this.height = init.height;
    this.fps = init.fps;

    this.minimumBitrate = init.minimumBitrate;
    this.maximumBitrate = init.maximumBitrate;
    this.encoderPreference =
      init.encoderPreference ?? RealtimeVideoEncoderPreference.maintainFramerate;
  }

  /**
   * 校验尺寸、帧率和显式指定的码率范围。
   * @throws 尺寸、帧率或码率配置无效时抛出错误。
   */
  validate(): void {
    if (
      this.width <= 0 ||
      this.height <= 0 ||
      this.fps <= 0 ||
      this.width % 2 !== 0 ||
      this.height % 2 !== 0
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Realtime video width and height must be positive " +
          "even numbers, and fps must be greater than zero",
      );
    }

    if (this.minimumBitrate !== undefined && this.minimumBitrate < 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Minimum bitrate must not be negative",
      );
    }
    if (this.maximumBitrate !== undefined && this.maximumBitrate <= 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Maximum bitrate must be greater than zero",
      );
    }

    if (
      this.minimumBitrate !== undefined &&
      this.maximumBitrate !== undefined &&
      this.minimumBitrate > this.maximumBitrate
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Minimum bitrate must not exceed maximum bitrate",
      );
    }
  }

  /**
   * 调整尺寸，保留帧率和上传编码配置。
   */
  resized(width: number, height: number): RealtimeVideoFormat {
    return new RealtimeVideoFormat({
      width,
      height,
      fps: this.fps,
      minimumBitrate: this.minimumBitrate,
      maximumBitrate: this.maximumBitrate,
      encoderPreference: this.encoderPreference,
    });
  }
}
