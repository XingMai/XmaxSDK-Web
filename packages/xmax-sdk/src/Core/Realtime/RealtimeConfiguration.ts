import type { RealtimeModel } from "../../Service/Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

export interface FrameInterpolationConfiguration {
  /** 是否请求开启远端插帧，默认 true。不支持时自动播放原视频。 */
  enabled?: boolean;
  /** 显示帧率上限，默认 60；每对源帧最多插入一帧。取值 1–60。 */
  targetFrameRate?: number;
}

export interface RealtimeConfigurationInit {
  /** 实时生成业务使用的模型。 */
  model: RealtimeModel;

  /**
   * 是否默认开启远端生成画面的插帧。
   * 与 iOS 对齐；frameInterpolation.enabled 显式设置时优先。
   */
  isFrameInterpolationEnabled?: boolean;
  frameInterpolation?: FrameInterpolationConfiguration;
}

/**
 * 创建实时 Manager 所需的业务配置。
 */
export class RealtimeConfiguration {
  /** 实时生成业务使用的模型。 */
  readonly model: RealtimeModel;

  /** 是否默认请求开启远端生成画面的插帧。 */
  readonly isFrameInterpolationEnabled: boolean;
  readonly frameInterpolation: Readonly<Required<FrameInterpolationConfiguration>>;

  /**
   * 创建实时业务配置。
   *
   * @param init.model 实时生成业务使用的模型。
   * @param init.isFrameInterpolationEnabled 是否默认开启远端生成画面的插帧。
   */
  constructor(init: RealtimeConfigurationInit) {
    this.model = init.model;
    const targetFrameRate = init.frameInterpolation?.targetFrameRate ?? 60;
    if (!Number.isFinite(targetFrameRate) || targetFrameRate < 1 || targetFrameRate > 60) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Interpolation targetFrameRate must be between 1 and 60");
    }
    this.isFrameInterpolationEnabled = init.frameInterpolation?.enabled ?? init.isFrameInterpolationEnabled ?? true;
    this.frameInterpolation = Object.freeze({ enabled: this.isFrameInterpolationEnabled, targetFrameRate });
  }
}
