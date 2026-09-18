import { XmaxError, XmaxErrorCode } from "../Errors/XmaxError";
import { CameraPosition } from "../Media/Camera/CameraPosition";
import {
  RtcEngineManager,
  type RtcEngine,
  type RtcEngineLease,
} from "./RtcEngineManager";
import type { RtcCameraCaptureOptions, RtcManaging } from "./RtcManaging";

/**
 * 基于 TRTC 的 RTC 能力管理器。
 *
 * 采集由 TRTC 内部完成：`startLocalVideo({ publish: false })` 只采不发，
 * 浏览器兼容性差异交由 TRTC 适配；视频轨通过 `getVideoTrack()` 取出后
 * 交给 SDK 自己的渲染层预览。
 */
export class RtcManager implements RtcManaging {
  // 依赖
  private readonly engineManager: RtcEngineManager;

  // RTC 资源
  private lease?: RtcEngineLease;

  // 采集状态
  private isCapturing = false;

  /**
   * 创建 RTC 管理器。
   *
   * @param engineManager 引擎租约管理组件（可替换，测试用）。
   */
  constructor(engineManager: RtcEngineManager = RtcEngineManager.shared) {
    this.engineManager = engineManager;
  }

  /** RTC 引擎是否已初始化。 */
  get isInitialized(): boolean {
    return this.lease !== undefined;
  }

  /** 初始化 RTC 引擎（获取独占租约）；已初始化时重复调用不产生效果。 */
  async initialize(): Promise<void> {
    if (this.lease) {
      return;
    }
    this.lease = await this.engineManager.acquire();
  }

  /** 停止采集并销毁 RTC 引擎、释放租约；未初始化时重复调用不产生效果。 */
  async destroy(): Promise<void> {
    const lease = this.lease;
    this.lease = undefined;
    this.isCapturing = false;
    if (!lease) {
      return;
    }
    try {
      await lease.engine.stopLocalVideo();
    } catch {
      // 引擎销毁前停止采集失败不影响租约释放。
    }
    this.engineManager.release(lease);
  }

  /**
   * 启动摄像头采集（不发布）。
   *
   * @returns 采集到的视频轨。
   * @throws 引擎未初始化、已在采集、设备不可用或权限被拒绝时抛出错误。
   */
  async startCameraCapture(
    options: RtcCameraCaptureOptions,
  ): Promise<MediaStreamTrack> {
    const engine = this.requireEngine();
    if (this.isCapturing) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera capture is already running",
      );
    }
    try {
      await engine.startLocalVideo({
        publish: false,
        option: {
          useFrontCamera: options.position === CameraPosition.front,
          profile: {
            width: options.width,
            height: options.height,
            frameRate: options.frameRate,
            bitrate: RtcManager.resolveBitrate(options),
          },
        },
      });
      const track = engine.getVideoTrack();
      if (!track) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "RTC engine did not produce a camera video track",
        );
      }
      this.isCapturing = true;
      return track;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * 在前置和后置摄像头之间切换。
   *
   * @returns 切换后的视频轨。
   * @throws 引擎未初始化、采集未启动或设备切换失败时抛出错误。
   */
  async switchCameraCapture(to: CameraPosition): Promise<MediaStreamTrack> {
    const engine = this.requireEngine();
    if (!this.isCapturing) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera capture is not running",
      );
    }
    try {
      await engine.updateLocalVideo({
        option: { useFrontCamera: to === CameraPosition.front },
      });
      const track = engine.getVideoTrack();
      if (!track) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "RTC engine did not produce a camera video track after switching",
        );
      }
      return track;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /** 停止摄像头采集；引擎未初始化或采集未启动时不产生效果。 */
  async stopCameraCapture(): Promise<void> {
    const engine = this.lease?.engine;
    this.isCapturing = false;
    if (!engine) {
      return;
    }
    try {
      await engine.stopLocalVideo();
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /** 返回当前引擎实例；未初始化时抛出错误。 */
  private requireEngine(): RtcEngine {
    const engine = this.lease?.engine;
    if (!engine) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "RTC engine is not initialized",
      );
    }
    return engine;
  }

  /** 将 TRTC 错误映射为 SDK 统一错误。 */
  private mapError(error: unknown): XmaxError {
    if (error instanceof XmaxError) {
      return error;
    }
    const rtcError = error as {
      message?: unknown;
      originError?: { name?: string };
    };
    const originName = rtcError?.originError?.name ?? "";
    const message =
      typeof rtcError?.message === "string" && rtcError.message.trim().length > 0
        ? rtcError.message.trim()
        : String(error);
    // 浏览器权限拒绝（getUserMedia 的 NotAllowedError 会被 TRTC 包装后抛出）。
    if (
      originName === "NotAllowedError" ||
      originName === "SecurityError" ||
      /NotAllowed/i.test(message)
    ) {
      return new XmaxError(XmaxErrorCode.cameraPermissionDenied, message);
    }
    // 其他设备层错误：无可用设备、设备被占用、采集参数不支持等。
    if (originName) {
      return new XmaxError(XmaxErrorCode.mediaError, message);
    }
    return new XmaxError(XmaxErrorCode.rtcError, message);
  }

  /** 按分辨率与帧率估算采集码率（kbps）。 */
  private static resolveBitrate(options: RtcCameraCaptureOptions): number {
    const estimated = Math.round(
      (options.width * options.height * options.frameRate * 0.12) / 1000,
    );
    return Math.min(Math.max(estimated, 200), 4000);
  }
}
