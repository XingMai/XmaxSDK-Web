import type { RealtimeModel } from "../../Service/Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * 远端视频插帧的开关与显示帧率配置。
 */
export interface FrameInterpolationConfiguration {
  /**
   * 是否请求开启远端插帧，默认 false。不支持时自动播放原视频。
   */
  enabled?: boolean;
  /**
   * 显示帧率上限，默认 60；每对源帧最多插入一帧。取值 1–60。
   */
  targetFrameRate?: number;
}

export interface RealtimeConfigurationInit {
  /**
   * 实时生成业务使用的模型。
   */
  model: RealtimeModel;

  /**
   * 是否默认开启远端生成画面的插帧，默认 false。
   * frameInterpolation.enabled 显式设置时优先。
   */
  isFrameInterpolationEnabled?: boolean;
  /**
   * 插帧详细配置；enabled 显式设置时优先于简化开关。
   */
  frameInterpolation?: FrameInterpolationConfiguration;
}

/**
 * 创建实时 Manager 所需的业务配置。
 */
export class RealtimeConfiguration {
  /**
   * 模型配置
   */
  /**
   * 实时生成业务使用的模型。
   */
  readonly model: RealtimeModel;

  /**
   * 远端插帧配置
   */
  /**
   * 是否默认请求开启远端生成画面的插帧。
   */
  readonly isFrameInterpolationEnabled: boolean;
  /**
   * 已补全默认值的只读插帧配置。
   */
  readonly frameInterpolation: Readonly<Required<FrameInterpolationConfiguration>>;

  /**
   * 创建实时业务配置。
   *
   * @param init.model 实时生成业务使用的模型。
   * @param init.isFrameInterpolationEnabled 是否默认开启远端生成画面的插帧。
   * @param init.frameInterpolation 插帧开关和显示帧率上限的详细配置。
   */
  constructor(init: RealtimeConfigurationInit) {
    this.model = init.model;

    const targetFrameRate = init.frameInterpolation?.targetFrameRate ?? 60;
    if (!Number.isFinite(targetFrameRate) || targetFrameRate < 1 || targetFrameRate > 60) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Interpolation targetFrameRate must be between 1 and 60");
    }

    this.isFrameInterpolationEnabled = init.frameInterpolation?.enabled ?? init.isFrameInterpolationEnabled ?? false;
    this.frameInterpolation = Object.freeze({ enabled: this.isFrameInterpolationEnabled, targetFrameRate });
  }
}
