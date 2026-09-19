import type { RealtimeModel } from "../../Service/Realtime/RealtimeModel";

export interface RealtimeConfigurationInit {
  /** 实时生成业务使用的模型。 */
  model: RealtimeModel;

  /**
   * 是否默认开启远端生成画面的插帧。
   * Web 首版不实现插帧，字段保留。
   */
  isFrameInterpolationEnabled?: boolean;
}

/**
 * 创建实时 Manager 所需的业务配置。
 */
export class RealtimeConfiguration {
  /** 实时生成业务使用的模型。 */
  readonly model: RealtimeModel;

  /** 是否默认开启远端生成画面的插帧（Web 首版保留字段，不生效）。 */
  readonly isFrameInterpolationEnabled: boolean;

  /**
   * 创建实时业务配置。
   *
   * @param init.model 实时生成业务使用的模型。
   * @param init.isFrameInterpolationEnabled 是否默认开启远端生成画面的插帧。
   */
  constructor(init: RealtimeConfigurationInit) {
    this.model = init.model;
    this.isFrameInterpolationEnabled = init.isFrameInterpolationEnabled ?? true;
  }
}
