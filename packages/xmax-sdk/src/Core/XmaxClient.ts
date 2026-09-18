import { XmaxLogger } from "../Foundation/Logging/XmaxLogger";
import type { MediaServicing } from "../Service/Media/MediaServicing";
import { MediaService } from "../Service/Media/MediaService";
import { RealtimeModel } from "./Realtime/RealtimeModel";
import type { RealtimeConfiguration } from "./Realtime/RealtimeConfiguration";
import { XmaxRealtimeManager } from "./Realtime/XmaxRealtimeManager";
import type { XmaxRealtimeManaging } from "./Realtime/XmaxRealtimeManaging";
import { XmaxConfiguration } from "./XmaxConfiguration";

/**
 * SDK 的统一入口，负责创建实时和媒体服务组件。
 */
export class XmaxClient {
  /** 客户端使用的全局配置。 */
  readonly configuration: XmaxConfiguration;

  /**
   * 创建 SDK 客户端。
   *
   * 本地相机预览不依赖 API Key 校验；服务端连接能力接入后，相关操作再校验配置。
   */
  constructor(configuration: XmaxConfiguration) {
    this.configuration = configuration;
    XmaxLogger.configure(
      configuration.loggerOptions,
      configuration.environment,
    );
  }

  /**
   * 创建实时媒体 Manager。
   *
   * @param options 实时生成模型等业务配置。
   * @returns 可用于创建和控制本地相机流的实时 Manager。
   */
  createRealtimeManager(options: RealtimeConfiguration): XmaxRealtimeManaging {
    return new XmaxRealtimeManager(options);
  }

  /**
   * 创建媒体处理与能力查询 Service。
   *
   * @param model 媒体输入规则使用的模型，默认为 `x2.0`。
   */
  createMediaService(model: RealtimeModel = RealtimeModel.x2_0): MediaServicing {
    return new MediaService(model);
  }
}
