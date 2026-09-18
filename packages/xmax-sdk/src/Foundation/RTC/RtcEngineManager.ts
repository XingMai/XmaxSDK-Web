import type TRTC from "trtc-sdk-v5";
import { XmaxError, XmaxErrorCode } from "../Errors/XmaxError";

/** TRTC 引擎实例类型。 */
export type RtcEngine = TRTC;

/**
 * 表示对共享 TRTC Engine 的独占使用权。
 */
export class RtcEngineLease {
  // RTC 资源
  /** 租约持有的 TRTC 引擎实例。 */
  readonly engine: RtcEngine;

  // 运行标识
  /** 租约标识。 */
  readonly id: string;

  constructor(engine: RtcEngine) {
    this.engine = engine;
    this.id = `lease-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

interface EngineRequest {
  id: string;
  resolve: (lease: RtcEngineLease) => void;
  reject: (error: unknown) => void;
}

/**
 * 管理共享 TRTC Engine 的独占创建、排队租用和销毁。
 *
 * `TRTC.create()` 不需要任何凭证（sdkAppId 在进房时才使用），
 * 因此引擎可以在本地预览阶段提前创建，不依赖会话接口返回。
 *
 * TRTC SDK 在模块加载时会访问浏览器环境，这里通过动态导入
 * 延迟到首次创建引擎时才加载，保证 SDK 包本身可以在非浏览器
 * 环境（如 SSR、测试）中正常导入。
 */
export class RtcEngineManager {
  /** 共享实例。 */
  static readonly shared = new RtcEngineManager();

  // 依赖
  private readonly makeEngine: () => Promise<RtcEngine>;

  // RTC 资源
  private activeLease?: RtcEngineLease;

  // 运行状态
  private requests: EngineRequest[] = [];

  /**
   * 创建引擎管理器。
   *
   * @param makeEngine 引擎工厂（可替换，测试用）。
   */
  constructor(
    makeEngine: () => Promise<RtcEngine> = RtcEngineManager.defaultMakeEngine,
  ) {
    this.makeEngine = makeEngine;
  }

  /**
   * 等待并获取一份独占 RTC Engine 租约。
   *
   * @returns 独占引擎租约；使用完毕必须调用 `release`。
   */
  async acquire(): Promise<RtcEngineLease> {
    if (!this.activeLease && this.requests.length === 0) {
      const lease = await this.createLease();
      this.activeLease = lease;
      return lease;
    }
    return new Promise<RtcEngineLease>((resolve, reject) => {
      this.requests.push({
        id: `req-${Date.now()}-${this.requests.length}`,
        resolve,
        reject,
      });
    });
  }

  /** 释放有效租约、销毁 Engine，并把独占权交给下一个等待者。 */
  release(lease: RtcEngineLease): void {
    if (this.activeLease?.id !== lease.id) {
      return;
    }
    this.activeLease = undefined;
    try {
      lease.engine.destroy();
    } catch {
      // 引擎销毁失败不影响租约释放（如退房前调用 destroy）。
    }
    void this.fulfillNextRequest();
  }

  /** 动态加载 TRTC SDK 并创建引擎实例。 */
  private static async defaultMakeEngine(): Promise<RtcEngine> {
    const module = await import("trtc-sdk-v5");
    return module.default.create();
  }

  /** 创建新引擎租约。 */
  private async createLease(): Promise<RtcEngineLease> {
    const engine = await this.makeEngine();
    if (!engine) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Failed to create RTC Engine",
      );
    }
    return new RtcEngineLease(engine);
  }

  /** 满足下一个排队请求；创建失败时拒绝该请求并继续处理后续请求。 */
  private async fulfillNextRequest(): Promise<void> {
    while (!this.activeLease && this.requests.length > 0) {
      const request = this.requests.shift();
      if (!request) {
        return;
      }
      try {
        const lease = await this.createLease();
        this.activeLease = lease;
        request.resolve(lease);
      } catch (error) {
        request.reject(error);
      }
    }
  }
}
