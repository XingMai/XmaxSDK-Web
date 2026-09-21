import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RemoteFrameInterpolationOptions } from "../../Render/Video/RemoteVideoFramePipeline";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeModel } from "../../Service/Realtime/RealtimeModel";
import { RealtimeSession } from "../../Service/Realtime/RealtimeSession";
import type { RealtimeSessionServicing } from "../../Service/Realtime/RealtimeSessionServicing";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import { VideoRenderRegistry, type VideoRenderTarget } from "../../Service/Realtime/VideoRenderBinding";
import type { RemoteStreamBinding, StreamControlling } from "../../Stream/StreamControlling";
import type { RoomEventTargetSize } from "../../Stream/Room/RoomEvent";
import type { RealtimeLaunchTimer } from "./RealtimeLaunchTimer";
import { RealtimeCoordinator } from "./RealtimeCoordinator";

/** 内部连接管理器：拥有会话、心跳、RTC 连接及远端轨道；不提交公开状态。 */
export class XmaxRealtimeConnectionManager {
  private activeSession?: RealtimeSession;
  private activeRemoteTrack?: RealtimeVideoTrack;
  private remoteBinding?: {
    target: VideoRenderTarget;
    setFrameInterpolation: (options?: RemoteFrameInterpolationOptions) => void;
    setMediaStream: (stream: MediaStream | null) => void;
    setMirrored: (mirrored: boolean) => void;
  };
  private targetSize?: RoomEventTargetSize;

  constructor(private readonly dependencies: {
    sessionService?: RealtimeSessionServicing;
    streamController: StreamControlling;
    timing: RealtimeLaunchTimer;
    isMirrored: () => boolean;
    remoteAudioVolume: () => number;
    onHeartbeatFailure: (sessionID: string, error: XmaxError) => void;
    onFrameDisplayed: () => void;
    onRenderAttached: () => void;
    onRenderDetached: () => void;
  }) {}

  get currentSessionID(): string | undefined { return this.activeSession?.id; }
  get currentTargetSize(): RoomEventTargetSize | undefined { return this.targetSize; }

  /** 未配置 API 服务时在连接操作开始前报错，不影响本地预览。 */
  validateConfiguration(): void { this.requireSessionService(); }

  async connect(options: {
    localTrack: RealtimeVideoTrack;
    model: RealtimeModel;
    includeLocalAudio: boolean;
    ensureCurrent: () => void;
    onPublished: () => void;
  }): Promise<RealtimeMediaStream> {
    const sessionService = this.requireSessionService();
    const streamController = this.dependencies.streamController;
    // 会话创建成功后立即登记，供失败清理时关闭会话。
    options.ensureCurrent();
    const completeConnection = this.dependencies.timing.startConnection();
    const session = await sessionService.createSession(options.model);
    this.activeSession = session;
    options.ensureCurrent();
    const connection = session.connection;
    if (!connection) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "Session does not contain RTC join information",
      );
    }

    // 发布本地流之前配置编码参数：采集阶段不发布，此处配置即可生效到发送端。
    const videoFormat = options.localTrack.videoFormat;
    if (!videoFormat) {
      throw new XmaxError(
        XmaxErrorCode.internalError,
        "Local video stream has no video format",
      );
    }
    await streamController.setVideoEncoderConfig(videoFormat);
    options.ensureCurrent();

    await streamController.connect(connection, options.includeLocalAudio, () => {
      options.ensureCurrent();
    });
    options.ensureCurrent();
    completeConnection();
    options.ensureCurrent();
    options.onPublished();

    sessionService.startHeartbeat(session.id, {
      onFailure: (sessionID, error) => {
        this.dependencies.onHeartbeatFailure(sessionID, error);
      },
      onRefresh: (refreshed) => {
        this.handleSessionRefresh(refreshed);
      },
    });

    const remoteTrack = new RealtimeVideoTrack({
      id: connection.botID ?? "video-remote",
      videoFormat: options.localTrack.videoFormat,
    });
    this.activeRemoteTrack = remoteTrack;
    this.registerRemoteBinding(remoteTrack);
    streamController.setRemoteAudioVolume(this.dependencies.remoteAudioVolume());

    return new RealtimeMediaStream({ id: StreamID.remote, videoTrack: remoteTrack });
  }

  setFrameInterpolation(options?: RemoteFrameInterpolationOptions): void {
    this.remoteBinding?.setFrameInterpolation(options);
  }

  clearRemoteMedia(): void { this.remoteBinding?.setMediaStream(null); }
  stopHeartbeat(): void { this.dependencies.sessionService?.stopHeartbeat(); }

  /** 等待接收轨解除静音；超时只警告，取消必须立即退出并移除监听。 */
  async waitUntilRemoteTrackReady(timeoutMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw RealtimeCoordinator.cancelledError();
    const mediaTrack = this.activeRemoteTrack?.mediaStreamTrack;
    if (!mediaTrack || !mediaTrack.muted) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        mediaTrack.removeEventListener("unmute", finish);
        signal.removeEventListener("abort", abort);
      };
      const finish = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(RealtimeCoordinator.cancelledError()); };
      const timer = setTimeout(() => {
        XmaxLogger.realtime.warning(() => "等待远端生成流首帧超时 (Timed Out Waiting for the First Remote Frame)");
        finish();
      }, timeoutMs);
      mediaTrack.addEventListener("unmute", finish);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  /**
   * 传输层远端生成流就绪或清理：更新远端轨道媒体轨并同步到渲染视图。
   *
   * @param binding 远端流及其视频轨；传入空值表示清理。
   * @throws 远端流到达但当前没有活动连接时抛出错误，使生成确认失败。
   */
  handleRemoteStreamBinding(binding: RemoteStreamBinding | null): void {
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
          this.dependencies.onFrameDisplayed();
        }
      },
      attachHandler: (view) => {
        this.remoteBinding?.setFrameInterpolation(undefined);
        view.isMirrored = this.dependencies.isMirrored();
        this.remoteBinding = {
          target: view,
          setFrameInterpolation: (options) => view.setFrameInterpolation?.(options),
          setMediaStream: (stream) => {
            view.setMediaStream(stream);
          },
          setMirrored: (mirrored) => {
            view.isMirrored = mirrored;
          },
        };
        this.dependencies.onRenderAttached();
        const mediaTrack = track.mediaStreamTrack;
        view.setMediaStream(mediaTrack ? new MediaStream([mediaTrack]) : null);
      },
      detachHandler: (view) => {
        if (this.remoteBinding?.target === view) {
          this.dependencies.onRenderDetached();
          this.remoteBinding = undefined;
        }
        view.setFrameInterpolation?.(undefined);
        view.setMediaStream(null);
      },
    });
  }

  /** 同步远端结果画面的镜像状态：与当前本地摄像头位置保持一致。 */
  updateRemoteMirror(): void {
    this.remoteBinding?.setMirrored(
      this.dependencies.isMirrored(),
    );
  }

  /** 构造当前远端生成结果媒体流。 */
  makeRemoteStream(): RealtimeMediaStream {
    const track = this.activeRemoteTrack;
    if (!track) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "The remote generation stream is unavailable",
      );
    }
    return new RealtimeMediaStream({ id: StreamID.remote, videoTrack: track });
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
      this.dependencies.onHeartbeatFailure(
        session.id,
        new XmaxError(XmaxErrorCode.sessionError, "RTC session binding changed during heartbeat"),
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
  /** 尽力清理全部连接资源，即使退房失败也关闭服务端会话。 */
  async disconnect(): Promise<string | undefined> {
    const sessionID = this.activeSession?.id;
    this.stopHeartbeat();
    this.clearRemoteMedia();
    try {
      await this.dependencies.streamController.disconnect();
    } catch (error) {
      XmaxLogger.realtime.error(() => `断开 RTC 连接失败 (Failed to Disconnect RTC)\n└─ ${XmaxError.from(error).message}`);
    }
    const track = this.activeRemoteTrack;
    if (track) {
      VideoRenderRegistry.unregister(track);
      track.mediaStreamTrack = undefined;
    }
    this.activeSession = undefined;
    this.activeRemoteTrack = undefined;
    this.remoteBinding = undefined;
    this.targetSize = undefined;
    if (sessionID && this.dependencies.sessionService) {
      try {
        await this.dependencies.sessionService.closeSession(sessionID);
      } catch (error) {
        XmaxLogger.realtime.error(() => `关闭实时会话失败 (Failed to Close Realtime Session)\n└─ ${XmaxError.from(error).message}`);
      }
    }
    return sessionID;
  }

  /** 获取会话 Service；未配置 API 服务时抛出配置错误。 */
  private requireSessionService(): RealtimeSessionServicing {
    if (!this.dependencies.sessionService) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "The realtime manager is not configured with an API service",
      );
    }
    return this.dependencies.sessionService;
  }
}
