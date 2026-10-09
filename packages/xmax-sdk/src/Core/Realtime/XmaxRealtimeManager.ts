import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import { watchMediaPermissionPrompt } from "../../Foundation/Permissions/MediaPermissionWatch";
import { createRtcManager } from "../../Foundation/RTC/RtcFactory";
import { XmaxEnvironment } from "../../Foundation/Runtime/XmaxEnvironment";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import type { NetworkStatistics, NetworkStatisticsListener } from "../../Foundation/RTC/NetworkStatistics";
import type { RemoteVideoStatistics, RemoteVideoStatisticsListener, VideoStatistics, VideoStatisticsListener } from "../../Foundation/RTC/VideoStatistics";
import { CameraController } from "../../Media/Camera/CameraController";
import type { CameraControlling } from "../../Media/Camera/CameraControlling";
import { NetworkVideoController } from "../../Media/Video/NetworkVideoController";
import { LocalVideoController } from "../../Media/Video/LocalVideoController";
import { frameInterpolationAdapter } from "../../Foundation/Media/Video/FrameInterpolationSupport";
import type { ModelSize } from "../../Service/Realtime/RealtimeModel";
import { MediaService } from "../../Service/Media/MediaService";
import type { ApiServicing } from "../../Service/Network/ApiServicing";
import { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeSessionServicing } from "../../Service/Realtime/RealtimeSessionServicing";
import { RealtimeSessionService } from "../../Service/Realtime/RealtimeSessionService";
import {
  RealtimeConnectionState,
  RealtimeState,
  type RealtimeStateListener,
} from "../../Service/Realtime/RealtimeState";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { StreamController } from "../../Stream/StreamController";
import type { StreamControlling } from "../../Stream/StreamControlling";
import type { RealtimeConfiguration } from "./RealtimeConfiguration";
import {
  RealtimeCoordinator,
  RealtimeOperationKind,
  RealtimeTerminationScope,
  type RealtimeCleanupResult,
  type RealtimeOperationToken,
} from "./RealtimeCoordinator";
import { RealtimeErrorHandler } from "./RealtimeErrorHandler";
import { RealtimeLaunchTimer } from "./RealtimeLaunchTimer";
import type { RealtimeLaunchTimingListener } from "../../Service/Realtime/RealtimeLaunchTiming";
import type { XmaxRealtimeManaging } from "./XmaxRealtimeManaging";
import { XmaxRealtimeConnectionManager } from "./XmaxRealtimeConnectionManager";
import { XmaxRealtimeGenerationManager } from "./XmaxRealtimeGenerationManager";

/**
 * 等待远端生成流首帧的时限（毫秒）；超时仅记录日志，不影响生成流程。
 */
const REMOTE_FIRST_FRAME_TIMEOUT_MS = 5_000;

/**
 * 实时能力门面：公开 API、本地媒体与连接/生成流程编排。
 *
 * 相机采集与房间传输共享同一个 RTC 引擎；会话由 Service 层创建并通过
 * 心跳维持。ConnectionManager 持有连接资源，GenerationManager 持有
 * 生成任务和上下文，Coordinator 统一管理公开状态、操作租约与取消。
 */
export class XmaxRealtimeManager implements XmaxRealtimeManaging {
  /**
   * 业务配置
   */
  readonly options: RealtimeConfiguration;
  private readonly mediaService: MediaService;

  /**
   * 本地流创建时的生成格式；上行编码调整不改变模型输入配置与远端插帧尺寸。
   */
  private generationVideoFormat?: RealtimeVideoFormat;

  /**
   * 插帧能力、用户配置与渲染版本
   */
  private readonly supportsInterpolation: (size?: ModelSize) => Promise<boolean>;
  private interpolationRequested: boolean;
  private interpolationSize?: ModelSize;
  private interpolationRevision = 0;

  /**
   * 业务组件
   */
  private readonly coordinator: RealtimeCoordinator;
  private readonly errorHandler: RealtimeErrorHandler;
  private readonly cameraController: CameraControlling;
  private readonly networkVideoController = new NetworkVideoController();
  private readonly localVideoController = new LocalVideoController((error) => {
    void this.coordinator.terminateWithError(error, RealtimeTerminationScope.connection);
  });
  private readonly rtcManager: RtcManaging;

  /**
   * 启动计时与首帧通知
   */
  private readonly launchTimer = new RealtimeLaunchTimer();
  private remoteFrameDisplayHandler?: () => void;

  /**
   * 媒体权限弹窗观察
   */
  private permissionWatchDispose?: () => void;

  /**
   * 本地、远端和网络统计快照及观察者
   */
  private localVideoStatistics?: VideoStatistics;
  private localVideoStatisticsListener?: VideoStatisticsListener;
  private remoteVideoStatistics?: RemoteVideoStatistics;
  private remoteVideoStatisticsListener?: RemoteVideoStatisticsListener;
  private acceptsVideoStatistics = false;
  private networkStatistics?: NetworkStatistics;
  private networkStatisticsListener?: NetworkStatisticsListener;

  /**
   * 实时业务管理组件；状态所有权分别归连接和生成管理器。
   */
  private readonly connectionManager: XmaxRealtimeConnectionManager;
  private readonly generationManager: XmaxRealtimeGenerationManager;
  private readonly streamController: StreamControlling;

  /**
   * 音量配置
   */
  private storedLocalAudioVolume = 1;
  private storedRemoteAudioVolume = 0;

  /**
   * 创建实时能力 Manager。
   *
   * @param options 实时生成模型等业务配置。
   * @param dependencies 可替换的内部组件（测试用）；未注入时按生产配置创建，
   * 相机控制器与传输层共享同一个 RTC 引擎。
   */
  constructor(options: RealtimeConfiguration, dependencies?: {
    environment?: XmaxEnvironment;
    apiService?: ApiServicing;
    sessionService?: RealtimeSessionServicing;
    streamController?: StreamControlling;
    cameraController?: CameraControlling;
    rtcManager?: RtcManaging;
    supportsFrameInterpolation?: (size?: ModelSize) => Promise<boolean>;
  }) {
    this.options = options;
    this.mediaService = new MediaService(options.model);

    this.interpolationRequested = options.isFrameInterpolationEnabled;
    this.supportsInterpolation = dependencies?.supportsFrameInterpolation ??
      (async (size) => (await frameInterpolationAdapter(size)) !== null);

    this.errorHandler = new RealtimeErrorHandler();

    const rtcManager = dependencies?.rtcManager ?? createRtcManager(options.provider, dependencies?.environment ?? XmaxEnvironment.china);
    this.rtcManager = rtcManager;
    this.cameraController = dependencies?.cameraController ?? new CameraController({
      rtcManager,
      mediaService: this.mediaService,
      errorListener: (error) => {
        void this.errorHandler.report(error);
      },
    });

    const sessionService =
      dependencies?.sessionService ??
      (dependencies?.apiService
        ? new RealtimeSessionService({ apiService: dependencies.apiService, provider: options.provider })
        : undefined);
    this.streamController = dependencies?.streamController ?? new StreamController({
      rtcManager,
      onCredentialsRequired: () => { void this.connectionManager.refreshCredentials(); },
      errorListener: (error) => {
        void this.errorHandler.report(error);
      },
      remoteStreamListener: (binding) => {
        this.clearRemoteVideoStatistics();
        this.connectionManager.handleRemoteStreamBinding(binding);
      },
    });

    this.connectionManager = new XmaxRealtimeConnectionManager({
      provider: options.provider,
      sessionService,
      streamController: this.streamController,
      timing: this.launchTimer,
      isMirrored: () => this.cameraController.currentTrack?.position === CameraPosition.front,
      remoteAudioVolume: () => this.storedRemoteAudioVolume,
      onHeartbeatFailure: (sessionID, error) => { void this.handleHeartbeatFailure(sessionID, error); },
      onFrameDisplayed: () => this.remoteFrameDisplayHandler?.(),
      onRenderAttached: () => this.applyRemoteInterpolation(),
      onRenderDetached: () => {
        this.interpolationRevision++;
      },
    });
    this.generationManager = new XmaxRealtimeGenerationManager(this.streamController);

    this.coordinator = new RealtimeCoordinator({
      errorHandler: this.errorHandler,
      cleanup: (scope, taskID) => this.performCleanup(scope, taskID),
    });

    this.streamController.setLocalVideoStatisticsListener((statistics) => {
      if (this.acceptsVideoStatistics) {
        this.localVideoStatistics = statistics ? Object.freeze({ ...statistics }) : undefined;
        this.notifyLocalVideoStatistics();
      }
    });

    this.streamController.setNetworkStatisticsListener((statistics) => {
      if (this.acceptsVideoStatistics) {
        this.networkStatistics = statistics ? Object.freeze({ ...statistics }) : undefined;
        this.notifyNetworkStatistics();
      }
    });

    this.streamController.setRemoteVideoStatisticsListener((statistics) => {
      if (this.acceptsVideoStatistics) {
        this.remoteVideoStatistics = statistics ? Object.freeze({ ...statistics }) : undefined;
        this.notifyRemoteVideoStatistics();
      }
    });
  }

  /**
   * 当前实时连接与生成状态。
   */
  get currentState(): RealtimeState {
    return this.coordinator.currentState;
  }

  /**
   * 当前是否请求启用插帧；能力探测或运行期降级后可能为 false。
   */
  get isFrameInterpolationEnabled(): boolean {
    return this.interpolationRequested;
  }

  /**
   * 串行更新插帧开关；开启前验证能力，不支持时抛错并保留原配置，不改变回传尺寸。
   */
  async setFrameInterpolationEnabled(enabled: boolean): Promise<void> {
    await this.coordinator.run(RealtimeOperationKind.configuration, undefined, async (token) => {
      const format = this.generationVideoFormat ?? this.currentLocalTrack?.videoFormat;
      const size = format && enabled ? this.mediaService.resolveFrameInterpolationSize(format) : undefined;
      if (enabled && !await this.checkInterpolationSupport(size, token)) {
        token.ensureCurrent();
        throw new XmaxError(XmaxErrorCode.frameInterpolationUnsupported, "Frame interpolation is unavailable on this device or for this size");
      }

      token.ensureCurrent();
      // 插帧仅影响本地渲染；能力检查失败时保留已有配置，不调整回传尺寸。
      this.interpolationRequested = enabled;
      this.interpolationSize = size;
      this.applyRemoteInterpolation();
    });
  }

  /**
   * 根据当前视频尺寸准备插帧，能力不可用时降级为原视频，并在应用前校验租约。
   */
  private async prepareFrameInterpolation(format: ModelSize, token: RealtimeOperationToken): Promise<void> {
    let size: ModelSize | undefined;
    if (this.interpolationRequested) {
      try {
        const candidate = this.mediaService.resolveFrameInterpolationSize(format);
        if (await this.checkInterpolationSupport(candidate, token)) size = candidate;
      } catch (error) {
        XmaxLogger.render.warning(() => `插帧不可用 (Frame Interpolation Unavailable)\n└─ ${XmaxError.from(error).message}`);
      }
    }

    token.ensureCurrent();
    // 能力检测确认不可用时关闭功能；短暂缺帧不改变开关状态。
    if (this.interpolationRequested && !size) this.interpolationRequested = false;
    this.interpolationSize = size;
    this.applyRemoteInterpolation();
  }

  /**
   * 在 5 秒预算内探测插帧能力；超时或探测失败返回 false，主动取消则拒绝。
   */
  private checkInterpolationSupport(size: ModelSize | undefined, token: RealtimeOperationToken): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const finish = (supported: boolean) => {
        cleanup();
        resolve(supported);
      };
      const abort = () => {
        cleanup();
        reject(RealtimeCoordinator.cancelledError());
      };

      const timer = setTimeout(() => finish(false), 5_000);
      const cleanup = () => {
        clearTimeout(timer);
        token.signal.removeEventListener("abort", abort);
      };

      token.signal.addEventListener("abort", abort, { once: true });
      if (token.signal.aborted) {
        abort();
        return;
      }

      void this.supportsInterpolation(size).then(finish, () => finish(false));
    });
  }

  /**
   * 将当前插帧配置同步到远端绑定，并用版本号忽略旧管线的迟到失败。
   */
  private applyRemoteInterpolation(): void {
    const revision = ++this.interpolationRevision;
    const size = this.interpolationSize;
    this.connectionManager.setFrameInterpolation(size ? {
      size,
      onFailure: (error) => {
        if (revision === this.interpolationRevision) this.handleInterpolationFailure(error);
      },
    } : undefined);
  }

  /**
   * 关闭已失败的插帧配置并记录降级原因，保持原始视频渲染可用。
   */
  private handleInterpolationFailure(error: unknown): void {
    this.interpolationRequested = false;
    this.interpolationSize = undefined;
    this.applyRemoteInterpolation();
    XmaxLogger.render.warning(() => `插帧已降级 (Frame Interpolation Disabled)\n└─ ${XmaxError.from(error).message}`);
  }

  /**
   * 当前本地媒体预览音量，取值范围为 `0...1`。
   */
  get localAudioVolume(): number {
    return this.storedLocalAudioVolume;
  }

  /**
   * 当前远端生成音频播放音量，取值范围为 `0...1`。
   */
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
   * 监听启动耗时；设置后立即回放，传 undefined 取消监听。
   */
  async setLaunchTimingListener(listener?: RealtimeLaunchTimingListener): Promise<void> {
    this.launchTimer.setListener(listener);
  }

  /**
   * 监听本地主视频流的实际运行统计；立即回放最新快照。
   */
  async setLocalVideoStatisticsListener(listener?: VideoStatisticsListener): Promise<void> {
    this.localVideoStatisticsListener = listener;
    this.notifyLocalVideoStatistics();
  }

  /**
   * 监听当前生成结果流的实际运行统计；立即回放最新快照。
   */
  async setRemoteVideoStatisticsListener(listener?: RemoteVideoStatisticsListener): Promise<void> {
    this.remoteVideoStatisticsListener = listener;
    this.notifyRemoteVideoStatistics();
  }

  /**
   * 回放当前远端视频统计，隔离观察者的同步和异步异常。
   */
  private notifyRemoteVideoStatistics(): void {
    try {
      void Promise.resolve(this.remoteVideoStatisticsListener?.(this.remoteVideoStatistics)).catch(() => {});
    } catch {
      // 统计观察者不得打断生成或资源清理。
    }
  }

  /**
   * 网络统计立即回放最新快照，无数据或断开后为 undefined。
   */
  async setNetworkStatisticsListener(listener?: NetworkStatisticsListener): Promise<void> {
    this.networkStatisticsListener = listener;
    this.notifyNetworkStatistics();
  }

  /**
   * 回放当前网络统计，隔离观察者的同步和异步异常。
   */
  private notifyNetworkStatistics(): void {
    try {
      void Promise.resolve(this.networkStatisticsListener?.(this.networkStatistics)).catch(() => {});
    } catch {
      // 统计观察者不得打断生成或资源清理。
    }
  }

  /**
   * 清除远端视频统计；原先存在数据时通知观察者数据已失效。
   */
  private clearRemoteVideoStatistics(): void {
    const hadStatistics = this.remoteVideoStatistics !== undefined;
    this.remoteVideoStatistics = undefined;
    if (hadStatistics) {
      this.notifyRemoteVideoStatistics();
    }
  }

  /**
   * 回放当前本地视频统计，隔离观察者的同步和异步异常。
   */
  private notifyLocalVideoStatistics(): void {
    try {
      void Promise.resolve(this.localVideoStatisticsListener?.(this.localVideoStatistics)).catch(() => {});
    } catch {
      // 统计观察者不得打断采集、生成或资源清理。
    }
  }

  /**
   * 停止接收媒体统计并清空各类快照，仅对曾有数据的统计发出清空通知。
   */
  private clearVideoStatistics(): void {
    this.acceptsVideoStatistics = false;

    const hadNetworkStatistics = this.networkStatistics !== undefined;
    this.networkStatistics = undefined;
    if (hadNetworkStatistics) this.notifyNetworkStatistics();

    this.clearRemoteVideoStatistics();

    const hadStatistics = this.localVideoStatistics !== undefined;
    this.localVideoStatistics = undefined;
    if (hadStatistics) {
      this.notifyLocalVideoStatistics();
    }
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
    if (!this.connectionManager.currentSessionID) {
      return;
    }
    try {
      this.streamController.setRemoteAudioVolume(volume);
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /**
   * 创建本地相机流并开始预览。
   *
   * 将返回的轨道绑定到预览视图；收到有效帧且视图已绑定后进入 `ready`。
   *
   * @param options.enableFrameValidation 是否在发布前等待相机预热（固定 200ms），默认 true；false 跳过等待。
   * @returns 包含本地相机视频轨道的媒体流。
   * @throws 模型不支持相机输入、配置无效、权限或采集启动失败时抛出错误。
   */
  async createLocalCameraStream(options: Parameters<XmaxRealtimeManaging["createLocalCameraStream"]>[0]): Promise<RealtimeMediaStream> {
    return this.coordinator.run(
      RealtimeOperationKind.media,
      undefined,
      async (token) => {
        this.ensureNoLocalSource();
        await this.coordinator.commit(
          new RealtimeState({
            connectionState: RealtimeConnectionState.preparing,
          }),
          token,
        );
        token.ensureCurrent();

        const completeCamera = this.launchTimer.startCamera();
        this.clearVideoStatistics();

        // 系统弹出授权请求时单独统计用户授权耗时；已授权或未弹窗不记录。
        // 麦克风可能在连接建立时才弹窗，观察器存活到相机流停止。
        this.disposePermissionWatch();
        const permissionWatch = await watchMediaPermissionPrompt(options?.useMicrophone ?? false);
        if (permissionWatch) {
          const completePermission = this.launchTimer.startPermission();
          void permissionWatch.decided.then(() => completePermission()).catch(() => {});
          this.permissionWatchDispose = permissionWatch.dispose;
        }

        let stream: RealtimeMediaStream;
        try {
          token.ensureCurrent();
          stream = await this.cameraController.createLocalCameraStream(options);
        } catch (error) {
          this.disposePermissionWatch();
          this.launchTimer.cancel();
          throw error;
        }

        token.ensureCurrent();
        this.generationVideoFormat = stream.videoTrack?.videoFormat;
        completeCamera();

        // 收到有效帧且预览视图绑定后进入 ready。
        this.cameraController.setPreviewReadyHandler((isCurrent) => {
          void this.coordinator.localPreviewDidBecomeReady(isCurrent);
        });

        return stream;
      },
    );
  }

  /**
   * 创建网络视频源并初始化接收端 RTC；预览是否加载成功不影响服务端读取视频。
   */
  async createNetworkVideoStream(options: Parameters<XmaxRealtimeManaging["createNetworkVideoStream"]>[0]): Promise<RealtimeMediaStream> {
    return this.coordinator.run(RealtimeOperationKind.media, undefined, async (token) => {
      this.ensureNoLocalSource();
      const stream = this.networkVideoController.create(options, this.mediaService);
      token.setFailureScope(RealtimeTerminationScope.all);
      this.launchTimer.start();
      this.clearVideoStatistics();

      await this.rtcManager.initialize();
      token.ensureCurrent();
      this.generationVideoFormat = stream.videoTrack?.videoFormat;
      await this.coordinator.commit(new RealtimeState({ connectionState: RealtimeConnectionState.ready }), token);
      return stream;
    });
  }

  /**
   * 创建文件音视频源并准备外部轨道；准备失败时统一释放本次媒体和 RTC 资源。
   */
  async createLocalVideoStream(options: Parameters<XmaxRealtimeManaging["createLocalVideoStream"]>[0]): Promise<RealtimeMediaStream> {
    return this.coordinator.run(RealtimeOperationKind.media, undefined, async (token) => {
      this.ensureNoLocalSource();
      if (!this.rtcManager.setExternalMediaTracks) {
        throw new XmaxError(XmaxErrorCode.invalidConfiguration, "The RTC provider does not support local video streams");
      }
      token.setFailureScope(RealtimeTerminationScope.all);
      this.launchTimer.start();
      this.clearVideoStatistics();

      // 不在浏览器播放解锁之前等待网络或 RTC 初始化，保留用户点击的激活状态。
      const stream = await this.localVideoController.create(options, this.mediaService, token.signal);
      token.ensureCurrent();
      await this.rtcManager.initialize();
      token.ensureCurrent();
      await this.rtcManager.setExternalMediaTracks({
        videoTrack: stream.videoTrack!.mediaStreamTrack!,
        audioTrack: this.localVideoController.audioTrack,
      });
      token.ensureCurrent();

      this.generationVideoFormat = stream.videoTrack?.videoFormat;
      await this.coordinator.commit(new RealtimeState({ connectionState: RealtimeConnectionState.ready }), token);
      return stream;
    });
  }

  /**
   * 当前 Manager 拥有的媒体源轨道。
   */
  private get currentLocalTrack(): RealtimeVideoTrack | undefined {
    return this.localVideoController.currentTrack ?? this.networkVideoController.currentTrack ?? this.cameraController.currentTrack;
  }

  /**
   * 创建前拒绝覆盖活动源，避免旧预览或连接资源被静默遗留。
   */
  private ensureNoLocalSource(): void {
    if (this.currentLocalTrack || this.localVideoController.isActive) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Close the current local stream before creating another one");
    }
  }

  /**
   * 移除媒体权限弹窗观察；授权决定已记录或不再需要观察时调用。
   */
  private disposePermissionWatch(): void {
    this.permissionWatchDispose?.();
    this.permissionWatchDispose = undefined;
  }

  /**
   * 应用完整的上行视频格式，成功后更新本地轨道元数据，不改变生成格式或生命周期。
   * 复用配置操作准入，避免与建连、切换摄像头或其他配置更新并发。
   *
   * @throws 无本地相机或文件视频流、参数无效、操作冲突或底层编码更新失败时抛错。
   */
  async updateVideoFormat(videoFormat: RealtimeVideoFormat): Promise<void> {
    await this.coordinator.run(RealtimeOperationKind.configuration, undefined, async (token) => {
      const track = this.localVideoController.currentTrack ?? this.cameraController.currentTrack;
      const previousFormat = track?.videoFormat;
      if (!track || !previousFormat) {
        throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Local camera or file video stream is not started");
      }
      videoFormat.validate();

      // 上行尺寸不按模型分辨率桶吸附，也不发送生成条件或回传尺寸信令。
      await this.streamController.setVideoEncoderConfig(videoFormat);
      token.ensureCurrent();

      this.generationVideoFormat ??= previousFormat;
      track.updateVideoFormat(videoFormat);
    });
  }

  /**
   * 停止本地相机流并释放本地预览与 RTC 资源。
   */
  async stopLocalCameraStream(): Promise<void> {
    if (this.networkVideoController.currentTrack || this.localVideoController.isActive) {
      return;
    }
    await this.coordinator.run(
      RealtimeOperationKind.media,
      undefined,
      async (token) => {
        this.launchTimer.cancel();
        this.clearVideoStatistics();
        this.disposePermissionWatch();
        await this.cameraController.stopLocalCameraStream();
        token.ensureCurrent();
        this.generationVideoFormat = undefined;
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
        this.connectionManager.updateRemoteMirror();
        return stream;
      },
    );
  }

  /**
   * 使用当前 Manager 创建的本地流建立实时连接。
   *
   * 创建实时会话、加入 RTC 房间并启动会话心跳；摄像头源发布本地流，网络视频源仅接收。
   * 启用帧检测时，发布前并行等待相机预热（固定 200ms），避免把黑帧推给 RTC。
   * 返回的远端媒体流在生成开始后承载远端生成画面。
   *
   * @param localStream 由当前 Manager 创建的摄像头、本地文件或网络视频源。
   * @returns 远端生成结果占位的媒体流。
   * @throws 本地流不属于当前 Manager、已有活动连接、会话创建或进房
   * 发布失败时抛出错误；失败时自动释放连接资源并恢复本地预览。
   */
  async connect(localStream: RealtimeMediaStream): Promise<RealtimeMediaStream> {
    return this.coordinator.run(
      RealtimeOperationKind.connection,
      undefined,
      async (token) => {
        const connectionState = this.coordinator.currentState.connectionState;
        if (
          connectionState === RealtimeConnectionState.connecting ||
          connectionState === RealtimeConnectionState.connected ||
          connectionState === RealtimeConnectionState.generating
        ) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "A realtime connection is already active",
          );
        }
        return this.performConnect(localStream, token);
      },
    );
  }

  /**
   * 按需建立连接并开始生成。
   *
   * 尚未连接时先建立实时连接；已在生成时仅更新生成条件，不重启生成。
   * 首次生成必须提供条件上下文，之后缺省时复用最近一次缓存的上下文。
   *
   * @param options.localStream 由当前 Manager 创建的摄像头、本地文件或网络视频源。
   * @param options.context 本次生成使用的条件上下文；缺省时复用缓存。
   * @returns 承载远端生成画面的媒体流。
   * @throws 本地流不属于当前 Manager、缺少可用的条件上下文、信令发送
   * 或生成确认失败时抛出错误；失败时自动停止生成任务并释放连接资源。
   */
  async startGeneration(options: {
    localStream: RealtimeMediaStream;
    context?: RealtimeContext;
  }): Promise<RealtimeMediaStream> {
    return this.coordinator.run(
      RealtimeOperationKind.generation,
      undefined,
      async (token) => {
        const localTrack = options.localStream.videoTrack;
        if (!localTrack || localTrack !== this.currentLocalTrack) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "The local stream must be created and started by this realtime manager",
          );
        }
        const videoFormat = this.generationVideoFormat ?? localTrack.videoFormat;
        if (!videoFormat) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "The local video format is unavailable",
          );
        }
        // 已在生成时只更新条件，不重新连接或启动任务。
        const currentState = this.coordinator.currentState;
        if (currentState.connectionState === RealtimeConnectionState.generating) {
          await this.generationManager.update(currentState.taskID, {
            videoFormat,
            context: options.context,
          });
          token.ensureCurrent();
          return this.connectionManager.makeRemoteStream();
        }
        const supplied = this.generationManager.validateContext(options.context);
        const referenceVideo = this.networkVideoController.reference;
        if (!referenceVideo && supplied.referenceVideo) {
          throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Create a network video stream before using a reference video");
        }
        const context = referenceVideo ? new RealtimeContext({ ...supplied, referenceVideo }) : supplied;

        // 尚未连接时先建立实时连接。
        if (currentState.connectionState !== RealtimeConnectionState.connected) {
          await this.performConnect(options.localStream, token);
        }

        return this.performStartGeneration(token, videoFormat, context);
      },
    );
  }

  /**
   * 断开实时连接并保留当前本地媒体预览。
   */
  async disconnect(): Promise<void> {
    this.localVideoController.pause();
    this.launchTimer.cancel();
    this.clearVideoStatistics();
    await this.coordinator.disconnect();
  }

  /**
   * 关闭当前实时生命周期并释放连接、本地媒体和 RTC Engine。
   * 关闭期间重复调用会等待同一个释放任务；关闭完成后仍可重新创建本地流。
   */
  async close(): Promise<void> {
    this.localVideoController.pause();
    this.launchTimer.cancel();
    this.clearVideoStatistics();
    await this.coordinator.terminate(RealtimeTerminationScope.all);
  }

  /**
   * 建立实时连接：创建会话、进房发布、启动心跳并准备远端渲染轨道。
   *
   * @param localStream 当前 Manager 创建的本地媒体流。
   * @param token 当前操作租约。
   * @returns 远端生成结果占位的媒体流。
   */
  private async performConnect(
    localStream: RealtimeMediaStream,
    token: RealtimeOperationToken,
  ): Promise<RealtimeMediaStream> {
    // 校验本地流归属与连接配置，避免无效请求改变连接状态。
    const localTrack = localStream.videoTrack;
    if (!localTrack || localTrack !== this.currentLocalTrack) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "The local stream must be created and started by this realtime manager",
      );
    }
    this.connectionManager.validateConfiguration();

    token.setFailureScope(RealtimeTerminationScope.connection);
    await this.coordinator.commit(
      new RealtimeState({ connectionState: RealtimeConnectionState.connecting }),
      token,
    );

    // 将预热等待绑定到本次连接操作；取消或退出连接流程时停止等待。
    const warmupController = new AbortController();
    const abortWarmup = () => warmupController.abort();
    token.signal.addEventListener("abort", abortWarmup, { once: true });
    if (token.signal.aborted) abortWarmup();

    try {
      let beforePublish: (() => Promise<void>) | undefined;
      if (!this.localVideoController.isActive && !this.networkVideoController.currentTrack && this.cameraController.isFrameValidationEnabled) {
        // 预热与建连并行，耗时计入连接；进房前预热失败也要接住拒绝，发布屏障仍等待原始结果。
        const cameraReady = this.cameraController.waitForValidCameraFrame(warmupController.signal).then(() => {
          token.ensureCurrent();
        });

        void cameraReady.catch(() => {});
        beforePublish = () => cameraReady;
      }

      const remote = await this.connectionManager.connect({
        localTrack,
        remoteVideoFormat: this.generationVideoFormat,
        model: this.options.model,
        includeLocalAudio: this.localVideoController.isActive
          ? this.localVideoController.audioTrack !== undefined
          : !this.networkVideoController.currentTrack && this.cameraController.useMicrophone,
        publishLocalMedia: !this.networkVideoController.currentTrack,
        ensureCurrent: () => token.ensureCurrent(),
        onPublished: () => {
          this.acceptsVideoStatistics = true;
        },
        beforePublish,
      });

      await this.coordinator.commit(
        new RealtimeState({
          connectionState: RealtimeConnectionState.connected,
          sessionID: this.connectionManager.currentSessionID,
        }),
        token,
      );

      return remote;
    } finally {
      token.signal.removeEventListener("abort", abortWarmup);
      abortWarmup();
    }
  }

  /**
   * 编排插帧、首帧计时和生成状态，任务与确认由生成管理器负责。
   */
  private async performStartGeneration(
    token: RealtimeOperationToken,
    videoFormat: NonNullable<RealtimeVideoTrack["videoFormat"]>,
    context: RealtimeContext,
  ): Promise<RealtimeMediaStream> {
    token.setFailureScope(RealtimeTerminationScope.connection);
    await this.prepareFrameInterpolation(videoFormat, token);

    const completeFirstFrame = this.launchTimer.startFirstFrame();
    this.remoteFrameDisplayHandler = () => {
      if (!token.signal.aborted) completeFirstFrame();
    };

    const taskID = await this.generationManager.start({
      videoFormat,
      context,
      signal: token.signal,
      ensureCurrent: () => token.ensureCurrent(),
      onStartSent: this.localVideoController.isActive ? async () => {
        token.ensureCurrent();
        await this.localVideoController.start(token.signal);
        token.ensureCurrent();
      } : undefined,
      waitUntilRemoteReady: () => this.connectionManager.waitUntilRemoteTrackReady(
        REMOTE_FIRST_FRAME_TIMEOUT_MS, token.signal,
      ),
    });

    const sessionID = this.connectionManager.currentSessionID;
    if (!sessionID) {
      throw new XmaxError(XmaxErrorCode.sessionError, "Realtime session is unavailable");
    }

    await this.coordinator.commit(
      new RealtimeState({ connectionState: RealtimeConnectionState.generating, sessionID, taskID }),
      token,
    );

    const onFinish = this.networkVideoController.onFinish;
    if (this.networkVideoController.currentTrack) {
      this.streamController.activateNetworkVideoCompletion(onFinish && (() => {
        if (this.currentState.taskID === taskID && this.currentState.connectionState === RealtimeConnectionState.generating) {
          return onFinish();
        }
      }));
    }

    return this.connectionManager.makeRemoteStream();
  }

  /**
   * 心跳失败或会话失效：结束当前连接生命周期并通过最终状态给出原因。
   */
  private async handleHeartbeatFailure(
    sessionID: string,
    error: XmaxError,
  ): Promise<void> {
    await this.coordinator.terminateWithError(
      error,
      RealtimeTerminationScope.connection,
      () => this.connectionManager.currentSessionID === sessionID,
    );
  }

  /**
   * 统一清理顺序：停止心跳与生成，再断开连接；all 额外释放本地媒体。
   */
  private async performCleanup(
    scope: RealtimeTerminationScope,
    taskID: string,
  ): Promise<RealtimeCleanupResult> {
    this.localVideoController.pause();
    this.launchTimer.cancel();
    this.remoteFrameDisplayHandler = undefined;
    this.clearVideoStatistics();

    this.interpolationSize = undefined;
    this.applyRemoteInterpolation();
    this.connectionManager.clearRemoteMedia();

    this.connectionManager.stopHeartbeat();
    await this.generationManager.reset(taskID);
    const sessionID = await this.connectionManager.disconnect();

    if (scope === RealtimeTerminationScope.all) {
      const hadFileSource = this.networkVideoController.currentTrack !== undefined || this.localVideoController.isActive;
      this.networkVideoController.stop();
      this.generationVideoFormat = undefined;
      this.disposePermissionWatch();
      try {
        if (hadFileSource) {
          await this.rtcManager.destroy();
        } else {
          await this.cameraController.stopLocalCameraStream();
        }
      } catch (error) {
        XmaxLogger.realtime.error(
          () =>
            `释放本地媒体失败 (Failed to Release Local Media)\n` +
            `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
        );
      } finally {
        if (this.localVideoController.isActive) {
          await this.localVideoController.stop();
        }
      }
    }

    return {
      sessionID,
      hasLocalMedia: this.currentLocalTrack !== undefined,
    };
  }

  /**
   * 校验音量取值范围为 `0...1`。
   */
  private static validateVolume(volume: number): void {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Audio volume must be between 0 and 1",
      );
    }
  }
}
