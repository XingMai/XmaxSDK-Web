import { XmaxLogger } from "../Foundation/Logging/XmaxLogger";
import type { ApiServicing } from "../Service/Network/ApiServicing";
import { ApiService } from "../Service/Network/ApiService";
import type { MediaServicing } from "../Service/Media/MediaServicing";
import { MediaService } from "../Service/Media/MediaService";
import type { StorageServicing } from "../Service/Storage/StorageServicing";
import { StorageService } from "../Service/Storage/StorageService";
import { RealtimeModel } from "../Service/Realtime/RealtimeModel";
import type { RealtimeConfiguration } from "./Realtime/RealtimeConfiguration";
import { XmaxRealtimeManager } from "./Realtime/XmaxRealtimeManager";
import type { XmaxRealtimeManaging } from "./Realtime/XmaxRealtimeManaging";
import { XmaxConfiguration } from "./XmaxConfiguration";
import { apiBaseURL } from "../Foundation/Runtime/XmaxEnvironment";

/**
 * SDK 的统一入口，负责创建实时和媒体服务组件。
 */
export class XmaxClient {
  /** 客户端使用的全局配置。 */
  readonly configuration: XmaxConfiguration;

  // 服务层组件
  private readonly apiService: ApiServicing;

  /**
   * 创建 SDK 客户端。
   *
   * 本地相机预览不依赖 API Key 校验；连接与生成等涉及服务端的操作
   * 在实际调用时校验 API Key。
   */
  constructor(configuration: XmaxConfiguration) {
    this.configuration = configuration;
    XmaxLogger.configure(
      configuration.loggerOptions,
      configuration.environment,
    );
    this.apiService = new ApiService({
      apiKey: configuration.apiKey,
      baseURL: apiBaseURL(configuration.environment),
    });
  }

  /**
   * 创建实时媒体 Manager。
   *
   * @param options 实时生成模型等业务配置。
   * @returns 可用于本地相机预览、实时连接与生成的实时 Manager。
   */
  createRealtimeManager(options: RealtimeConfiguration): XmaxRealtimeManaging {
    return new XmaxRealtimeManager(options, { apiService: this.apiService });
  }

  /**
   * 创建媒体处理与能力查询 Service。
   *
   * @param model 媒体输入规则使用的模型，默认为 `x2.0`。
   */
  createMediaService(model: RealtimeModel = RealtimeModel.x2_0): MediaServicing {
    return new MediaService(model);
  }

  /**
   * 创建文件存储 Service。
   *
   * @returns 可上传图片到对象存储的存储 Service，返回地址可用作参考图路径。
   */
  createStorageService(): StorageServicing {
    return new StorageService({ apiService: this.apiService });
  }
}
