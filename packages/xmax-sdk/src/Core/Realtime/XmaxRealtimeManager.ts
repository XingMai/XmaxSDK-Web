import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { CameraController } from "../../Media/Camera/CameraController";
import type { CameraControlling } from "../../Media/Camera/CameraControlling";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import {
  RealtimeConnectionState,
  RealtimeState,
  type RealtimeStateListener,
} from "../../Service/Realtime/RealtimeState";
import type { RealtimeConfiguration } from "./RealtimeConfiguration";
import {
  RealtimeCoordinator,
  RealtimeOperationKind,
  RealtimeTerminationScope,
} from "./RealtimeCoordinator";
import { RealtimeErrorHandler } from "./RealtimeErrorHandler";
import type { XmaxRealtimeManaging } from "./XmaxRealtimeManaging";

const M2_HINT =
  "Realtime connection and generation are not supported yet in this build " +
  "(planned for milestone M2 with TRTC)";

/**
 * 实时能力 Manager：摄像头本地管线 + 实时连接与生成（M2）。
 */
export class XmaxRealtimeManager implements XmaxRealtimeManaging {
  // 业务配置
  readonly options: RealtimeConfiguration;

  // 业务组件
  private readonly coordinator: RealtimeCoordinator;
  private readonly errorHandler: RealtimeErrorHandler;
  private readonly cameraController: CameraControlling;

  // 音量配置
  private storedLocalAudioVolume = 1;
  private storedRemoteAudioVolume = 0;

  /**
   * 创建实时能力 Manager。
   *
   * @param options 实时生成模型等业务配置。
   * @param dependencies 可替换的内部组件（测试用）。
   */
  constructor(options: RealtimeConfiguration, dependencies?: {
    cameraController?: CameraControlling;
  }) {
    this.options = options;
    this.errorHandler = new RealtimeErrorHandler();
    this.cameraController = dependencies?.cameraController ?? new CameraController({
      errorListener: (error) => {
        void this.errorHandler.report(error);
      },
    });
    this.coordinator = new RealtimeCoordinator({
      errorHandler: this.errorHandler,
      cleanup: (scope) => this.performCleanup(scope),
    });
  }

  /** 当前实时连接与生成状态。 */
  get currentState(): RealtimeState {
    return this.coordinator.currentState;
  }

  /** 当前本地媒体预览音量，取值范围为 `0...1`。 */
  get localAudioVolume(): number {
    return this.storedLocalAudioVolume;
  }

  /** 当前远端生成音频播放音量，取值范围为 `0...1`。 */
  get remoteAudioVolume(): number {
    return this.storedRemoteAudioVolume;
  }

  /**
   * 设置实时状态监听器；设置后立即回放当前状态。
   *
   * @param listener 实时状态回调；传入 `undefined` 时清除监听器。
   */
  async setStateListener(listener?: RealtimeStateListener): Promise<void> {
    await this.coordinator.setStateListener(listener);
  }

  /**
   * 设置本地媒体预览音量。
   *
   * @param volume 本地预览音量，取值范围为 `0...1`。
   * @throws 音量超出有效范围时抛出错误。
   */
  async setLocalAudioVolume(volume: number): Promise<void> {
    XmaxRealtimeManager.validateVolume(volume);
    this.storedLocalAudioVolume = volume;
  }

  /**
   * 设置远端生成音频播放音量。
   * 尚未连接或订阅远端流时保存配置，并在远端音频开始播放前应用。
   *
   * @param volume 远端播放音量，取值范围为 `0...1`。
   * @throws 音量超出有效范围或 RTC 音量配置失败时抛出错误。
   */
  async setRemoteAudioVolume(volume: number): Promise<void> {
    XmaxRealtimeManager.validateVolume(volume);
    this.storedRemoteAudioVolume = volume;
  }

  /**
   * 创建本地相机流并开始预览。
   *
   * 将返回的轨道绑定到预览视图；收到有效帧且视图已绑定后进入 `ready`。
   *
   * @returns 包含本地相机视频轨道的媒体流。
   * @throws 模型不支持相机输入、配置无效、权限或采集启动失败时抛出错误。
   */
  async createLocalCameraStream(options: Parameters<XmaxRealtimeManaging["createLocalCameraStream"]>[0]): Promise<RealtimeMediaStream> {
    return this.coordinator.run(
      RealtimeOperationKind.media,
      undefined,
      async (token) => {
        await this.coordinator.commit(
          new RealtimeState({
            connectionState: RealtimeConnectionState.preparing,
          }),
          token,
        );
        const stream = await this.cameraController.createLocalCameraStream(options);
        token.ensureCurrent();
        // 收到有效帧且预览视图绑定后进入 ready。
        this.cameraController.setPreviewReadyHandler((isCurrent) => {
          void this.coordinator.localPreviewDidBecomeReady(isCurrent);
        });
        return stream;
      },
    );
  }

  /** 停止本地相机流并释放本地预览与 RTC 资源。 */
  async stopLocalCameraStream(): Promise<void> {
    await this.coordinator.run(
      RealtimeOperationKind.media,
      undefined,
      async (token) => {
        await this.cameraController.stopLocalCameraStream();
        token.ensureCurrent();
        await this.coordinator.commit(
          new RealtimeState({ connectionState: RealtimeConnectionState.idle }),
          token,
        );
      },
    );
  }

  /**
   * 切换前后置摄像头。
   *
   * 生成过程中调用时，SDK 会停止当前生成、切换摄像头，并使用缓存的生成
   * 条件恢复生成；RTC 连接保持不变。连接或生成正在启动时不可切换。
   *
   * @returns 复用原视频轨道并更新摄像头位置后的本地媒体流。
   */
  async switchCamera(): Promise<RealtimeMediaStream> {
    return this.coordinator.run(
      RealtimeOperationKind.cameraSwitch,
      undefined,
      async (token) => {
        const stream = await this.cameraController.switchCamera();
        token.ensureCurrent();
        return stream;
      },
    );
  }

  /**
   * 使用当前 Manager 创建的本地流建立实时连接。
   * （M2 接入 TRTC 后生效。）
   */
  async connect(_localStream: RealtimeMediaStream): Promise<RealtimeMediaStream> {
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, M2_HINT);
  }

  /**
   * 按需建立连接并开始生成。
   * （M2 接入 TRTC 后生效。）
   */
  async startGeneration(_options: {
    localStream: RealtimeMediaStream;
    context: RealtimeContext;
  }): Promise<RealtimeMediaStream> {
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, M2_HINT);
  }

  /** 断开实时连接并保留当前本地媒体预览。 */
  async disconnect(): Promise<void> {
    await this.coordinator.disconnect();
  }

  /**
   * 关闭当前实时生命周期并释放连接、本地媒体和 RTC Engine。
   * 关闭期间重复调用会等待同一个释放任务；关闭完成后仍可重新创建本地流。
   */
  async close(): Promise<void> {
    await this.coordinator.terminate(RealtimeTerminationScope.all);
  }

  /** 分级清理：connection 释放远端资源（M2），all 额外释放本地媒体。 */
  private async performCleanup(
    scope: RealtimeTerminationScope,
  ): Promise<{ hasLocalMedia: boolean }> {
    if (scope === RealtimeTerminationScope.all) {
      try {
        await this.cameraController.stopLocalCameraStream();
      } catch (error) {
        XmaxLogger.realtime.error(
          () =>
            `停止本地相机流失败 (Failed to Stop Local Camera Stream)\n` +
            `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
        );
      }
    }
    return { hasLocalMedia: this.cameraController.currentTrack !== undefined };
  }

  /** 校验音量取值范围为 `0...1`。 */
  private static validateVolume(volume: number): void {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Audio volume must be between 0 and 1",
      );
    }
  }
}
