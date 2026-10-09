import { supportedRtcProviders, type RealtimeModelName } from "../../Service/Realtime/RealtimeModel";
import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * 创建实时 Manager 所需的业务配置。
 */
export class RealtimeConfiguration {
  /**
   * 实时生成业务使用的模型。
   */
  readonly model: RealtimeModelName;

  /**
   * 实时连接使用的 RTC 提供方。
   */
  readonly provider: RtcProvider;

  /**
   * 是否默认请求开启远端生成画面的插帧。
   */
  readonly isFrameInterpolationEnabled: boolean;

  /**
   * 创建实时业务配置。
   *
   * @param init.model 实时生成业务使用的模型；未知名称原样透传，默认配置同 x2.1-preview。
   * @param init.provider RTC 提供方，默认按模型定义选择；必须受模型支持，创建后不可切换。
   * @param init.isFrameInterpolationEnabled 是否默认开启远端生成画面的插帧，默认 false。
   */
  constructor(init: {
    model: RealtimeModelName;
    provider?: RtcProvider;
    isFrameInterpolationEnabled?: boolean;
  }) {
    const providers = supportedRtcProviders(init.model);
    this.provider = init.provider ?? providers[0]!;
    if (!Object.values(RtcProvider).includes(this.provider)) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Unsupported RTC provider");
    }
    if (!providers.includes(this.provider)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        `Model ${init.model} does not support RTC provider ${this.provider}`,
      );
    }
    this.model = init.model;

    this.isFrameInterpolationEnabled = init.isFrameInterpolationEnabled ?? false;
  }
}
