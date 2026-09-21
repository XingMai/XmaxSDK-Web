import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import { RtcManager } from "../../Foundation/RTC/RtcManager";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import { CameraController } from "../../Media/Camera/CameraController";
import type { CameraControlling } from "../../Media/Camera/CameraControlling";
import { VideoRenderRegistry } from "../../Service/Realtime/VideoRenderBinding";
import { MediaService } from "../../Service/Media/MediaService";
import type { ApiServicing } from "../../Service/Network/ApiServicing";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import { RealtimeSession } from "../../Service/Realtime/RealtimeSession";
import type { RealtimeSessionServicing } from "../../Service/Realtime/RealtimeSessionServicing";
import { RealtimeSessionService } from "../../Service/Realtime/RealtimeSessionService";
import {
  RealtimeConnectionState,
  RealtimeState,
  type RealtimeStateListener,
} from "../../Service/Realtime/RealtimeState";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import { StreamController } from "../../Stream/StreamController";
import type {
  RemoteStreamBinding,
  StreamControlling,
} from "../../Stream/StreamControlling";
import type { RoomEventTargetSize } from "../../Stream/Room/RoomEvent";
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

/** 等待远端生成流首帧的时限（毫秒）；超时仅记录日志，不影响生成流程。 */
const REMOTE_FIRST_FRAME_TIMEOUT_MS = 5_000;

/**
 * 实时能力 Manager：摄像头本地管线、实时连接与生成。
 *
 * 相机采集与房间传输共享同一个 RTC 引擎；会话由 Service 层创建并通过
 * 心跳维持，传输层负责进房、发布订阅和生成任务确认。
 */
export class XmaxRealtimeManager implements XmaxRealtimeManaging {
  // 业务配置
  readonly options: RealtimeConfiguration;

  // 业务组件
  private readonly coordinator: RealtimeCoordinator;
  private readonly errorHandler: RealtimeErrorHandler;
  private readonly cameraController: CameraControlling;
  private readonly launchTimer = new RealtimeLaunchTimer();
  private remoteFrameDisplayHandler?: () => void;

  // 服务层组件
  private readonly sessionService?: RealtimeSessionServicing;

  // 传输层组件
  private readonly streamController?: StreamControlling;

  // 音量配置
  private storedLocalAudioVolume = 1;
  private storedRemoteAudioVolume = 0;

  // 连接资源
  private activeSession?: RealtimeSession;
  private activeRemoteTrack?: RealtimeVideoTrack;
  private remoteBinding?: {
    setMediaStream: (stream: MediaStream | null) => void;
    setMirrored: (mirrored: boolean) => void;
  };

  // 生成资源
  private currentContext?: RealtimeContext;
  private currentTargetSize?: RoomEventTargetSize;

  /**
   * 创建实时能力 Manager。
   *
   * @param options 实时生成模型等业务配置。
   * @param dependencies 可替换的内部组件（测试用）；未注入时按生产配置创建，
   * 相机控制器与传输层共享同一个 RTC 引擎。
   */
  constructor(options: RealtimeConfiguration, dependencies?: {
    apiService?: ApiServicing;
    sessionService?: RealtimeSessionServicing;
    streamController?: StreamControlling;
    cameraController?: CameraControlling;
    rtcManager?: RtcManaging;
  }) {
    this.options = options;
    this.errorHandler = new RealtimeErrorHandler();

    const rtcManager = dependencies?.rtcManager ?? new RtcManager();
    this.cameraController = dependencies?.cameraController ?? new CameraController({
      rtcManager,
      mediaService: new MediaService(options.model),
      errorListener: (error) => {
        void this.errorHandler.report(error);
      },
    });
    this.sessionService =
      dependencies?.sessionService ??
      (dependencies?.apiService
        ? new RealtimeSessionService({ apiService: dependencies.apiService })
        : undefined);
    this.streamController = dependencies?.streamController ?? new StreamController({
      rtcManager,
      errorListener: (error) => {
        void this.errorHandler.report(error);
      },
      remoteStreamListener: (binding) => {
        this.handleRemoteStreamBinding(binding);
      },
    });
    this.coordinator = new RealtimeCoordinator({
      errorHandler: this.errorHandler,
      cleanup: (scope, taskID) => this.performCleanup(scope, taskID),
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

  /** 监听启动耗时；设置后立即回放，传 undefined 取消监听。 */
  async setLaunchTimingListener(listener?: RealtimeLaunchTimingListener): Promise<void> {
    this.launchTimer.setListener(listener);
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
    if (!this.activeSession || !this.streamController) {
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
        token.ensureCurrent();
        const completeCamera = this.launchTimer.startCamera();
        let stream: RealtimeMediaStream;
        try {
          token.ensureCurrent();
          stream = await this.cameraController.createLocalCameraStream(options);
        } catch (error) {
          this.launchTimer.cancel();
          throw error;
        }
        token.ensureCurrent();
        completeCamera();
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
        this.launchTimer.cancel();
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
        this.updateRemoteMirror();
        return stream;
      },
    );
  }

  /**
   * 使用当前 Manager 创建的本地流建立实时连接。
   *
   * 创建实时会话、加入 RTC 房间并发布本地流，成功后启动会话心跳。
   * 返回的远端媒体流在生成开始后承载远端生成画面。
   *
   * @param localStream 由 `createLocalCameraStream` 创建的本地媒体流。
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
   * @param options.localStream 由 `createLocalCameraStream` 创建的本地媒体流。
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
        if (!localTrack || localTrack !== this.cameraController.currentTrack) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "The local stream must be created and started by this realtime manager",
          );
        }
        const videoFormat = localTrack.videoFormat;
        if (!videoFormat) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "The local video format is unavailable",
          );
        }
        const context = options.context ?? this.currentContext;

        // 已在生成：仅发送条件变更信令并更新缓存，不重启生成。
        const currentState = this.coordinator.currentState;
        if (currentState.connectionState === RealtimeConnectionState.generating) {
          const taskID = currentState.taskID;
          if (!taskID || !context) {
            throw new XmaxError(
              XmaxErrorCode.invalidConfiguration,
              "A realtime context is required to update the current generation",
            );
          }
          this.requireStreamController().updateGeneration({
            taskID,
            videoFormat,
            targetSize: this.currentTargetSize,
            context,
          });
          this.currentContext = context;
          return this.makeRemoteStream();
        }

        if (!context) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "A realtime context is required for the first generation",
          );
        }

        // 尚未连接时先建立实时连接。
        if (currentState.connectionState !== RealtimeConnectionState.connected) {
          await this.performConnect(options.localStream, token);
        }

        return this.performStartGeneration(token, videoFormat, context);
      },
    );
  }

  /** 断开实时连接并保留当前本地媒体预览。 */
  async disconnect(): Promise<void> {
    this.launchTimer.cancel();
    await this.coordinator.disconnect();
  }

  /**
   * 关闭当前实时生命周期并释放连接、本地媒体和 RTC Engine。
   * 关闭期间重复调用会等待同一个释放任务；关闭完成后仍可重新创建本地流。
   */
  async close(): Promise<void> {
    this.launchTimer.cancel();
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
    const localTrack = localStream.videoTrack;
    if (!localTrack || localTrack !== this.cameraController.currentTrack) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "The local stream must be created and started by this realtime manager",
      );
    }
    const sessionService = this.requireSessionService();
    const streamController = this.requireStreamController();

    token.setFailureScope(RealtimeTerminationScope.connection);
    await this.coordinator.commit(
      new RealtimeState({ connectionState: RealtimeConnectionState.connecting }),
      token,
    );

    // 会话创建成功后立即登记，供失败清理时关闭会话。
    token.ensureCurrent();
    const completeConnection = this.launchTimer.startConnection();
    const session = await sessionService.createSession(this.options.model);
    this.activeSession = session;
    const connection = session.connection;
    if (!connection) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "Session does not contain RTC join information",
      );
    }

    // 发布本地流之前配置编码参数：采集阶段不发布，此处配置即可生效到发送端。
    const videoFormat = localTrack.videoFormat;
    if (!videoFormat) {
      throw new XmaxError(
        XmaxErrorCode.internalError,
        "Local video stream has no video format",
      );
    }
    await streamController.setVideoEncoderConfig(videoFormat);
    token.ensureCurrent();

    await streamController.connect(connection, this.cameraController.useMicrophone, () => {
      token.ensureCurrent();
    });
    token.ensureCurrent();
    completeConnection();
    token.ensureCurrent();

    sessionService.startHeartbeat(session.id, {
      onFailure: (sessionID, error) => {
        void this.handleHeartbeatFailure(sessionID, error);
      },
      onRefresh: (refreshed) => {
        this.handleSessionRefresh(refreshed);
      },
    });

    const remoteTrack = new RealtimeVideoTrack({
      id: connection.botID ?? "video-remote",
      videoFormat: localTrack.videoFormat,
    });
    this.activeRemoteTrack = remoteTrack;
    this.registerRemoteBinding(remoteTrack);
    streamController.setRemoteAudioVolume(this.storedRemoteAudioVolume);

    await this.coordinator.commit(
      new RealtimeState({
        connectionState: RealtimeConnectionState.connected,
        sessionID: session.id,
      }),
      token,
    );
    return new RealtimeMediaStream({ id: StreamID.remote, videoTrack: remoteTrack });
  }

  /**
   * 发送开始生成信令并等待远端结果流确认；确认后等待远端首帧并激活音频。
   *
   * @param token 当前操作租约。
   * @param videoFormat 当前本地媒体使用的视频格式。
   * @param context 本次生成使用的条件上下文。
   * @returns 承载远端生成画面的媒体流。
   */
  private async performStartGeneration(
    token: RealtimeOperationToken,
    videoFormat: NonNullable<RealtimeVideoTrack["videoFormat"]>,
    context: RealtimeContext,
  ): Promise<RealtimeMediaStream> {
    const streamController = this.requireStreamController();
    token.setFailureScope(RealtimeTerminationScope.connection);

    const taskID = XmaxRealtimeManager.createTaskID();
    try {
      const completeFirstFrame = this.launchTimer.startFirstFrame();
      this.remoteFrameDisplayHandler = () => {
        if (!token.signal.aborted) {
          completeFirstFrame();
        }
      };
      const confirmation = streamController.beginGeneration({
        taskID,
        videoFormat,
        targetSize: this.currentTargetSize,
        context,
      });
      await this.awaitGenerationConfirmation(confirmation, token);
      token.ensureCurrent();

      this.currentContext = context;
      await this.waitUntilRemoteTrackReady(REMOTE_FIRST_FRAME_TIMEOUT_MS);
      await streamController.activateRemoteAudio();

      const sessionID = this.activeSession?.id;
      if (!sessionID) {
        throw new XmaxError(
          XmaxErrorCode.sessionError,
          "Realtime session is unavailable",
        );
      }
      await this.coordinator.commit(
        new RealtimeState({
          connectionState: RealtimeConnectionState.generating,
          sessionID,
          taskID,
        }),
        token,
      );
      return this.makeRemoteStream();
    } catch (error) {
      try {
        await streamController.stopGeneration(taskID);
      } catch (stopError) {
        XmaxLogger.realtime.error(
          () =>
            `停止生成任务失败 (Failed to Stop Generation Task)\n` +
            `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(stopError).message}`,
        );
      }
      throw error;
    }
  }

  /** 等待生成确认；操作被取消时立即以取消错误结束等待。 */
  private async awaitGenerationConfirmation(
    confirmation: Promise<void>,
    token: RealtimeOperationToken,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      confirmation.then(resolve, reject);
      if (token.signal.aborted) {
        reject(RealtimeCoordinator.cancelledError());
        return;
      }
      token.signal.addEventListener(
        "abort",
        () => {
          reject(RealtimeCoordinator.cancelledError());
        },
        { once: true },
      );
    });
  }

  /**
   * 等待远端生成视频轨收到首帧；超时仅记录日志，不阻断生成流程。
   *
   * @param timeoutMs 等待时限（毫秒）。
   */
  private async waitUntilRemoteTrackReady(timeoutMs: number): Promise<void> {
    const mediaTrack = this.activeRemoteTrack?.mediaStreamTrack;
    if (!mediaTrack || !mediaTrack.muted) {
      return;
    }
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        mediaTrack.removeEventListener("unmute", onUnmute);
        resolve();
      };
      const onUnmute = () => {
        finish();
      };
      const timer = setTimeout(() => {
        XmaxLogger.realtime.warning(
          () => "等待远端生成流首帧超时 (Timed Out Waiting for the First Remote Frame)",
        );
        finish();
      }, timeoutMs);
      mediaTrack.addEventListener("unmute", onUnmute);
    });
  }

  /**
   * 传输层远端生成流就绪或清理：更新远端轨道媒体轨并同步到渲染视图。
   *
   * @param binding 远端流及其视频轨；传入空值表示清理。
   * @throws 远端流到达但当前没有活动连接时抛出错误，使生成确认失败。
   */
  private handleRemoteStreamBinding(binding: RemoteStreamBinding | null): void {
    const track = this.activeRemoteTrack;
    if (!binding) {
      if (track) {
        track.mediaStreamTrack = undefined;
      }
      this.remoteBinding?.setMediaStream(null);
      return;
    }
    if (!track) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Remote generation stream arrived without an active realtime connection",
      );
    }
    track.mediaStreamTrack = binding.videoTrack;
    this.remoteBinding?.setMediaStream(new MediaStream([binding.videoTrack]));
  }

  /** 为远端轨道注册渲染绑定：attach 时挂流占位，媒体轨到达后送入画面。 */
  private registerRemoteBinding(track: RealtimeVideoTrack): void {
    VideoRenderRegistry.register(track, {
      frameDisplayHandler: () => {
        if (this.activeRemoteTrack === track) {
          this.remoteFrameDisplayHandler?.();
        }
      },
      attachHandler: (view) => {
        view.isMirrored =
          this.cameraController.currentTrack?.position === CameraPosition.front;
        this.remoteBinding = {
          setMediaStream: (stream) => {
            view.setMediaStream(stream);
          },
          setMirrored: (mirrored) => {
            view.isMirrored = mirrored;
          },
        };
        const mediaTrack = track.mediaStreamTrack;
        view.setMediaStream(mediaTrack ? new MediaStream([mediaTrack]) : null);
      },
      detachHandler: (view) => {
        this.remoteBinding = undefined;
        view.setMediaStream(null);
      },
    });
  }

  /** 同步远端结果画面的镜像状态：与当前本地摄像头位置保持一致。 */
  private updateRemoteMirror(): void {
    this.remoteBinding?.setMirrored(
      this.cameraController.currentTrack?.position === CameraPosition.front,
    );
  }

  /** 构造当前远端生成结果媒体流。 */
  private makeRemoteStream(): RealtimeMediaStream {
    const track = this.activeRemoteTrack;
    if (!track) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "The remote generation stream is unavailable",
      );
    }
    return new RealtimeMediaStream({ id: StreamID.remote, videoTrack: track });
  }

  /** 心跳失败或会话失效：结束当前连接生命周期并通过最终状态给出原因。 */
  private async handleHeartbeatFailure(
    sessionID: string,
    error: XmaxError,
  ): Promise<void> {
    await this.coordinator.terminateWithError(
      error,
      RealtimeTerminationScope.connection,
      () => this.activeSession?.id === sessionID,
    );
  }

  /**
   * 心跳成功后的凭据刷新：仅凭据变化时覆盖本地缓存；房间绑定信息
   * （提供方、房间、应用、登录身份）变化时当前连接失效，按失败结束。
   */
  private handleSessionRefresh(session: RealtimeSession): void {
    const current = this.activeSession;
    if (!current || current.id !== session.id) {
      return;
    }
    const next = session.connection;
    if (!next) {
      return;
    }
    const previous = current.connection;
    const bindingChanged =
      previous !== undefined &&
      (next.provider !== previous.provider ||
        next.roomID !== previous.roomID ||
        next.sdkAppID !== previous.sdkAppID ||
        next.userID !== previous.userID);
    if (bindingChanged) {
      void this.coordinator.terminateWithError(
        new XmaxError(
          XmaxErrorCode.sessionError,
          "RTC session binding changed during heartbeat",
        ),
        RealtimeTerminationScope.connection,
        () => this.activeSession?.id === session.id,
      );
      return;
    }
    this.activeSession = new RealtimeSession({
      id: session.id,
      userID: session.userID ?? current.userID,
      status: session.status ?? current.status,
      connection: next,
      closeReason: session.closeReason,
    });
  }

  /** 分级清理：两种范围都释放连接资源，all 额外释放本地媒体。 */
  private async performCleanup(
    scope: RealtimeTerminationScope,
    taskID: string,
  ): Promise<RealtimeCleanupResult> {
    this.launchTimer.cancel();
    this.remoteFrameDisplayHandler = undefined;
    const sessionID = this.activeSession?.id;

    this.sessionService?.stopHeartbeat();
    if (taskID && this.streamController) {
      try {
        await this.streamController.stopGeneration(taskID);
      } catch (error) {
        XmaxLogger.realtime.error(
          () =>
            `停止生成任务失败 (Failed to Stop Generation Task)\n` +
            `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
        );
      }
    }
    if (this.streamController) {
      try {
        await this.streamController.disconnect();
      } catch (error) {
        XmaxLogger.realtime.error(
          () =>
            `断开 RTC 连接失败 (Failed to Disconnect RTC)\n` +
            `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
        );
      }
    }
    const remoteTrack = this.activeRemoteTrack;
    if (remoteTrack) {
      VideoRenderRegistry.unregister(remoteTrack);
      remoteTrack.mediaStreamTrack = undefined;
    }
    this.activeSession = undefined;
    this.activeRemoteTrack = undefined;
    this.remoteBinding = undefined;
    this.currentContext = undefined;
    this.currentTargetSize = undefined;

    if (sessionID && this.sessionService) {
      try {
        await this.sessionService.closeSession(sessionID);
      } catch (error) {
        XmaxLogger.realtime.error(
          () =>
            `关闭实时会话失败 (Failed to Close Realtime Session)\n` +
            `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
        );
      }
    }

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
    return {
      sessionID,
      hasLocalMedia: this.cameraController.currentTrack !== undefined,
    };
  }

  /** 获取会话 Service；未配置 API 服务时抛出配置错误。 */
  private requireSessionService(): RealtimeSessionServicing {
    if (!this.sessionService) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "The realtime manager is not configured with an API service",
      );
    }
    return this.sessionService;
  }

  /** 获取传输层控制器；未配置时抛出配置错误。 */
  private requireStreamController(): StreamControlling {
    if (!this.streamController) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "The realtime manager is not configured with a stream controller",
      );
    }
    return this.streamController;
  }

  /** 生成当前生成任务的唯一标识。 */
  private static createTaskID(): string {
    const hex = crypto.randomUUID().replace(/-/g, "");
    let binary = "";
    for (let index = 0; index < 16; index += 1) {
      binary += String.fromCharCode(parseInt(hex.slice(index * 2, index * 2 + 2), 16));
    }
    const base64url = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `task-${base64url}?os=web`;
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
