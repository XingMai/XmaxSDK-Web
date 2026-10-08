import type { AREAS, IAgoraRTC, IAgoraRTCClient, IAgoraRTCRemoteUser, ICameraVideoTrack, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";
import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { XmaxLogger } from "../../Logging/XmaxLogger";
import { CameraPosition } from "../../Media/Camera/CameraPosition";
import { XmaxEnvironment } from "../../Runtime/XmaxEnvironment";
import type { RtcManaging, RtcCameraCaptureOptions } from "../RtcManaging";
import type { RtcEventListener } from "../RtcEventListener";
import type { RtcRoomJoinConfiguration, AgoraRoomJoinConfiguration } from "../RoomJoinConfiguration";
import { RtcVideoEncoderPreference, type VideoEncodingConfiguration } from "../VideoEncodingConfiguration";
import { AgoraRtcStatistics } from "./AgoraRtcStatistics";

/**
 * 固定版本 SDK 的 DataStream 扩展；官方公共类型未暴露发送方法。
 */
export interface AgoraDataStreamClient extends IAgoraRTCClient {
  /**
   * 发送 UTF-8 房间消息；关闭底层重试，错误交给业务操作处理。
   */
  sendStreamMessage(message: string, needRetry: boolean): Promise<void>;
}

/**
 * 可替换的声网模块加载器，仅在初始化时加载浏览器依赖。
 */
export interface AgoraRtcManagerOptions {
  environment: XmaxEnvironment;
  loadSDK?: () => Promise<IAgoraRTC>;
}

/**
 * 声网媒体、房间与 DataStream 适配器；每个实例拥有独立 client 和媒体轨道。
 */
export class AgoraRtcManager implements RtcManaging {
  /**
   * 模块级区域约束：setArea 是全局设置，拒绝同时运行不同区域，避免静默覆盖。
   */
  private static readonly regions = new Map<IAgoraRTC, { environment: XmaxEnvironment; count: number }>();

  /**
   * 配置与 RTC 资源
   */
  private readonly environment: XmaxEnvironment;
  private readonly loadSDK: () => Promise<IAgoraRTC>;
  private sdk?: IAgoraRTC;
  private client?: AgoraDataStreamClient;
  private initialization?: Promise<void>;
  private lifecycle = 0;
  private camera?: ICameraVideoTrack;
  private microphone?: IMicrophoneAudioTrack;
  private connection?: AgoraRoomJoinConfiguration;
  private roomVersion = 0;

  /**
   * 凭据恢复与发布意图；RTC 自动断开可能清空 localTracks，因此单独保留发布意图。
   */
  private tokenExpired = false;
  private rejoinOperation?: Promise<void>;
  private rejoinTask?: Promise<void>;
  private cancelRejoin?: () => void;
  private videoPublishRequested = false;
  private audioPublishRequested = false;

  /**
   * 事件、统计与音频播放状态
   */
  private listener?: RtcEventListener;
  private statisticsTimer?: ReturnType<typeof setInterval>;
  private readonly audioVolumes = new Map<string, number>();
  private readonly requestedAudio = new Set<string>();

  /**
   * DataStream 串行发送与限速状态；等待中的消息通过房间版本取消。
   */
  private sendTail: Promise<void> = Promise.resolve();
  private sentPackets: { time: number; bytes: number }[] = [];
  private cancelSendDelay?: () => void;
  private cancelActiveSend?: () => void;

  /**
   * 保存服务环境与加载器，不触发浏览器依赖或设备权限请求。
   */
  constructor(options: AgoraRtcManagerOptions) {
    this.environment = options.environment;
    this.loadSDK = options.loadSDK ?? (async () => (await import("agora-rtc-sdk-ng")).default);
  }

  /**
   * 当前实例是否已创建声网 client。
   */
  get isInitialized(): boolean { return this.client !== undefined; }

  /**
   * 声网音频轨支持播放前设置音量；零音量额外停止播放以防浏览器差异。
   */
  get supportsRemoteAudioVolumeControl(): boolean { return true; }

  /**
   * 共享本实例的初始化任务，区域完全由接入方环境决定。
   */
  async initialize(): Promise<void> {
    if (this.client) return;
    if (this.initialization) return this.initialization;

    const version = this.lifecycle;
    const operation = this.performInitialize(version);
    this.initialization = operation;
    try {
      await operation;
    } finally {
      if (this.initialization === operation) this.initialization = undefined;
    }
  }

  /**
   * 加载模块、锁定区域并注册事件；迟到的初始化不能复活已销毁实例。
   */
  private async performInitialize(version: number): Promise<void> {
    const sdk = await this.loadSDK();
    if (version !== this.lifecycle) throw this.cancelled();

    const region = AgoraRtcManager.regions.get(sdk);
    if (region && region.environment !== this.environment) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Concurrent Agora clients must use the same XmaxEnvironment");
    }
    sdk.setLogLevel(4);
    if (!region) sdk.setArea([(this.environment === XmaxEnvironment.china ? "CHINA" : "GLOBAL") as AREAS]);

    const client = sdk.createClient({ mode: "rtc", codec: "h264" }) as AgoraDataStreamClient;
    if (typeof client.sendStreamMessage !== "function") {
      throw new XmaxError(XmaxErrorCode.rtcError, "Agora DataStream is unavailable in this SDK version");
    }
    AgoraRtcManager.regions.set(sdk, { environment: this.environment, count: (region?.count ?? 0) + 1 });
    this.sdk = sdk;
    this.client = client;
    this.registerEvents(client);
  }

  /**
   * 先失效全部异步工作，再释放房间、采集、监听和区域引用。
   */
  async destroy(): Promise<void> {
    this.lifecycle++;
    const client = this.client;
    this.listener = undefined;
    this.clearRoom();
    this.client = undefined;
    client?.removeAllListeners();
    this.camera?.close();
    this.microphone?.close();
    this.camera = undefined;
    this.microphone = undefined;

    const sdk = this.sdk;
    this.sdk = undefined;
    try {
      await client?.leave();
    } catch {
      XmaxLogger.rtc.warning(() => "Agora 退房失败，已释放本地资源 (Agora Leave Failed)");
    } finally {
      const region = sdk && AgoraRtcManager.regions.get(sdk);
      if (sdk && region && --region.count === 0) AgoraRtcManager.regions.delete(sdk);
    }
  }

  /**
   * 通过声网采集相机但不发布，返回原生轨道供公共渲染层使用。
   */
  async startCameraCapture(options: RtcCameraCaptureOptions): Promise<MediaStreamTrack> {
    const client = this.requireClient();
    if (this.camera) throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Camera capture is already running");

    try {
      const camera = await this.sdk!.createCameraVideoTrack({
        facingMode: options.position === CameraPosition.front ? "user" : "environment",
        encoderConfig: { width: options.width, height: options.height, frameRate: options.frameRate },
      });
      if (this.client !== client) { camera.close(); throw this.cancelled(); }
      this.camera = camera;
      return camera.getMediaStreamTrack();
    } catch (error) {
      throw this.mapError(error, XmaxErrorCode.cameraPermissionDenied);
    }
  }

  /**
   * 切换声网相机设备并返回切换后的原生轨道。
   */
  async switchCameraCapture(to: CameraPosition): Promise<MediaStreamTrack> {
    const camera = this.requireCamera();
    await this.run(() => camera.setDevice({ facingMode: to === CameraPosition.front ? "user" : "environment" }));
    if (this.camera !== camera) throw this.cancelled();
    return camera.getMediaStreamTrack();
  }

  /**
   * 停止采集并释放摄像头。
   */
  async stopCameraCapture(): Promise<void> {
    const camera = this.camera;
    this.camera = undefined;
    camera?.close();
  }

  /**
   * 应用公共编码配置，不使用 TRTC 专属的竖屏尺寸转置。
   */
  async configureVideoEncoding(config: VideoEncodingConfiguration): Promise<void> {
    const camera = this.requireCamera();
    await this.run(async () => {
      await camera.setEncoderConfiguration({ width: config.width, height: config.height, frameRate: config.frameRate,
        bitrateMin: config.minimumBitrate, bitrateMax: config.maximumBitrate });
      await camera.setOptimizationMode(config.encoderPreference === RtcVideoEncoderPreference.maintainFramerate ? "motion" : "detail");
    });
  }

  /**
   * 使用会话下发的字符串频道与 UID 入房；不采信后端区域覆盖。
   */
  async joinRoom(configuration: RtcRoomJoinConfiguration): Promise<void> {
    // 旧重进房操作完全结束后才允许新进房，避免迟到的 leave 影响新连接。
    await this.rejoinTask?.catch(() => {});
    const client = this.requireClient();
    if (configuration.provider !== "agora" || this.connection) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Agora credentials and an idle room are required");
    }
    const version = ++this.roomVersion;
    await this.run(() => client.join(configuration.appID, configuration.roomID, configuration.roomToken, configuration.userID));
    if (client !== this.client || version !== this.roomVersion) {
      await client.leave();
      throw this.cancelled();
    }

    this.connection = configuration;
    // 入房期间可能已经收到发布事件；从 SDK 当前状态补齐一次，避免遗漏现有机器人。
    for (const user of client.remoteUsers) {
      if (user.hasVideo) this.listener?.onRemoteVideoPublished(String(user.uid), true);
    }
    this.statisticsTimer = setInterval(() => {
      if (this.client !== client || !this.connection || this.tokenExpired || this.rejoinOperation) return;
      try { AgoraRtcStatistics.collect(client, this.listener); }
      catch { XmaxLogger.rtc.warning(() => "Agora 统计采样失败 (Agora Statistics Failed)"); }
    }, 2000);
  }

  /**
   * 退房前取消排队消息、统计与音频播放；本地相机预览保持运行。
   */
  async leaveRoom(): Promise<void> {
    this.clearRoom();
    if (this.client) await this.run(() => this.client!.leave());
  }

  /**
   * 应用同一频道的新 Token；即将过期时续签，已经过期时重新进房并恢复媒体。
   */
  async updateCredentials(config: RtcRoomJoinConfiguration, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw this.cancelled();
    const current = this.connection;
    const client = this.requireClient();
    if (!current || config.provider !== "agora" || config.appID !== current.appID || config.roomID !== current.roomID || config.userID !== current.userID) {
      throw new XmaxError(XmaxErrorCode.sessionError, "Agora session binding changed");
    }
    const version = this.roomVersion;
    if (!this.tokenExpired) {
      try {
        await this.run(() => client.renewToken(config.roomToken));
      } catch (error) {
        // 续签过程中可能已跨过过期时间；此时升级为重进房，不再重复 renewToken。
        this.ensureRoomCurrent(client, version);
        if (!this.tokenExpired) throw error;
      }
    }
    this.ensureRoomCurrent(client, version);
    if (signal?.aborted) throw this.cancelled();

    if (this.tokenExpired) await this.rejoinRoom(client, config, signal);
    else this.connection = config;
  }

  /**
   * 串行恢复同一 RTC 房间，不创建业务会话或重新发送生成开始指令。
   */
  private async rejoinRoom(client: AgoraDataStreamClient, config: AgoraRoomJoinConfiguration, signal?: AbortSignal): Promise<void> {
    if (this.rejoinOperation) return this.rejoinOperation;

    const version = ++this.roomVersion;
    const task = Promise.resolve().then(() => this.performRejoin(client, config, version));
    this.rejoinTask = task;
    void task.finally(() => {
      if (this.rejoinTask === task) this.rejoinTask = undefined;
    }).catch(() => {});

    // 取消立即释放业务等待；底层 SDK 的迟到 join 继续由 task 负责退房收尾。
    let cancel!: () => void;
    const operation = new Promise<void>((resolve, reject) => {
      cancel = () => {
        if (this.isRoomCurrent(client, version)) this.roomVersion++;
        reject(this.cancelled());
      };
      this.cancelRejoin = cancel;
      signal?.addEventListener("abort", cancel, { once: true });
      task.then(resolve, reject);
      if (signal?.aborted) cancel();
    });
    this.rejoinOperation = operation;
    try {
      await operation;
    } finally {
      signal?.removeEventListener("abort", cancel);
      if (this.cancelRejoin === cancel) this.cancelRejoin = undefined;
      if (this.rejoinOperation === operation) this.rejoinOperation = undefined;
    }

    this.ensureRoomCurrent(client, version);
    for (const user of client.remoteUsers) {
      if (user.hasVideo) this.listener?.onRemoteVideoPublished(String(user.uid), true);
    }
  }

  /**
   * 使用新 Token 重建 RTC 连接，复用采集轨道并恢复远端音频订阅。
   */
  private async performRejoin(client: AgoraDataStreamClient, config: AgoraRoomJoinConfiguration, version: number): Promise<void> {
    this.ensureRoomCurrent(client, version);
    this.cancelSendDelay?.();
    this.cancelActiveSend?.();
    this.listener?.onRoomRejoining?.();
    for (const user of client.remoteUsers) user.audioTrack?.stop();

    await this.run(() => client.leave());
    this.ensureRoomCurrent(client, version);
    await this.run(() => client.join(config.appID, config.roomID, config.roomToken, config.userID));
    if (!this.isRoomCurrent(client, version)) {
      // 退房或销毁期间迟到的 join 仍可能成功，必须释放刚建立的连接。
      await this.run(() => client.leave());
      throw this.cancelled();
    }

    if (this.videoPublishRequested && this.camera) {
      await this.run(() => client.publish(this.camera!));
      this.ensureRoomCurrent(client, version);
    }
    if (this.audioPublishRequested && this.microphone) {
      await this.run(() => client.publish(this.microphone!));
      this.ensureRoomCurrent(client, version);
    }

    for (const user of client.remoteUsers) {
      if (!user.hasAudio || !this.requestedAudio.has(String(user.uid))) continue;
      const track = await this.run(() => client.subscribe(user, "audio"));
      if (!this.isRoomCurrent(client, version)) {
        track.stop();
        throw this.cancelled();
      }
      // 恢复期间用户仍可静音或停止生成，使用最新音量与订阅意图。
      this.applyAudioVolume(user);
    }

    this.connection = config;
    this.tokenExpired = false;
    this.sentPackets = [];
  }

  /**
   * 发布已采集的视频轨道。
   */
  async publishLocalVideo(): Promise<void> {
    const client = this.requireClient();
    const camera = this.requireCamera();
    this.videoPublishRequested = true;
    await this.rejoinOperation;
    if (client !== this.client || !this.videoPublishRequested) throw this.cancelled();
    if (client.localTracks.includes(camera)) return;
    await this.run(() => client.publish(camera));
  }

  /**
   * 停止视频发布但保留采集与预览。
   */
  async unpublishLocalVideo(): Promise<void> {
    this.videoPublishRequested = false;
    if (this.rejoinTask || this.tokenExpired) return;
    if (this.client && this.camera) await this.run(() => this.client!.unpublish(this.camera!));
  }

  /**
   * 首次发布时申请麦克风；取消后的迟到采集立即释放。
   */
  async publishLocalAudio(): Promise<void> {
    const client = this.requireClient();
    this.audioPublishRequested = true;
    await this.rejoinOperation;
    const version = this.roomVersion;
    if (client !== this.client || !this.audioPublishRequested) throw this.cancelled();
    try {
      if (!this.microphone) {
        const track = await this.sdk!.createMicrophoneAudioTrack();
        if (client !== this.client || version !== this.roomVersion) { track.close(); throw this.cancelled(); }
        this.microphone = track;
      }
      if (!client.localTracks.includes(this.microphone)) await client.publish(this.microphone);
    } catch (error) {
      throw this.mapError(error, XmaxErrorCode.microphonePermissionDenied);
    }
  }

  /**
   * 停止音频发布，采集交给关闭流程释放。
   */
  async unpublishLocalAudio(): Promise<void> {
    this.audioPublishRequested = false;
    if (this.rejoinTask || this.tokenExpired) return;
    if (this.client && this.microphone) await this.run(() => this.client!.unpublish(this.microphone!));
  }

  /**
   * 订阅远端主视频并返回原生轨道，不创建额外播放视图。
   */
  async subscribeRemoteVideo(userID: string, subscribe: boolean): Promise<MediaStreamTrack | undefined> {
    if (!subscribe && this.rejoinTask) return;
    await this.rejoinOperation;
    const client = this.requireClient();
    const user = client.remoteUsers.find(user => String(user.uid) === userID);
    if (!user && !subscribe) return;
    if (!user) throw new XmaxError(XmaxErrorCode.rtcError, "Agora remote video user is unavailable");
    if (!subscribe) { await this.run(() => client.unsubscribe(user, "video")); return; }

    const version = this.roomVersion;
    const track = await this.run(() => client.subscribe(user, "video"));
    if (client !== this.client || version !== this.roomVersion) throw this.cancelled();
    return track.getMediaStreamTrack();
  }

  /**
   * 保存音频订阅意图；音频稍后发布时自动订阅，播放前应用音量。
   */
  async subscribeRemoteAudio(userID: string, subscribe: boolean): Promise<void> {
    const client = this.requireClient();
    const user = client.remoteUsers.find(user => String(user.uid) === userID);
    if (!subscribe) {
      this.requestedAudio.delete(userID);
      user?.audioTrack?.stop();
      if (user?.audioTrack && !this.rejoinTask) await this.run(() => client.unsubscribe(user, "audio"));
      return;
    }
    this.requestedAudio.add(userID);
    if (this.rejoinOperation) {
      const version = this.roomVersion;
      await this.rejoinOperation;
      this.ensureRoomCurrent(client, version);
      if (this.requestedAudio.has(userID)) await this.subscribeRemoteAudio(userID, true);
      return;
    }
    if (!user?.hasAudio) return;

    const version = this.roomVersion;
    const track = await this.run(() => client.subscribe(user, "audio"));
    if (client !== this.client || version !== this.roomVersion || !this.requestedAudio.has(userID)) {
      track.stop();
      return;
    }
    this.applyAudioVolume(user);
  }

  /**
   * 缓存音量，订阅前可调用；零音量不调用 play，防止初始短暂漏声。
   */
  setRemoteAudioVolume(volume: number, userID: string): void {
    this.audioVolumes.set(userID, Math.max(0, Math.min(100, Number.isFinite(volume) ? Math.round(volume) : 0)));
    const user = this.client?.remoteUsers.find(user => String(user.uid) === userID);
    if (this.rejoinTask || this.tokenExpired) {
      user?.audioTrack?.stop();
      return;
    }
    if (user) this.applyAudioVolume(user);
  }

  /**
   * 应用当前用户的播放状态，保留声网对浏览器自动播放限制的处理。
   */
  private applyAudioVolume(user: IAgoraRTCRemoteUser): void {
    const track = user.audioTrack;
    if (!track) return;
    const volume = this.audioVolumes.get(String(user.uid)) ?? 0;
    track.setVolume(volume);
    if (volume > 0 && this.requestedAudio.has(String(user.uid))) track.play();
    else track.stop();
  }

  /**
   * 按房间顺序发送消息，限制每秒包数与总字节；失败返回给原业务调用。
   */
  sendRoomMessage(message: string): Promise<void> {
    const version = this.roomVersion;
    const client = this.client;
    const bytes = new TextEncoder().encode(message).byteLength;
    const operation = this.sendTail.then(async () => {
      await this.rejoinOperation;
      if (!client || client !== this.client || !this.connection || version !== this.roomVersion || this.tokenExpired) throw this.cancelled();
      if (bytes > 1000) throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Room message exceeds the 1000-byte limit");

      await this.waitForSendBudget(bytes, version);
      await this.rejoinOperation;
      if (client !== this.client || version !== this.roomVersion || !this.connection || this.tokenExpired) throw this.cancelled();
      this.sentPackets.push({ time: Date.now(), bytes });
      await this.sendWithTimeout(client, message);
    });
    this.sendTail = operation.catch(() => {});
    return operation;
  }

  /**
   * 发送超过五秒视为失败；退房立即取消等待，底层迟到结果不影响新房间。
   */
  private async sendWithTimeout(client: AgoraDataStreamClient, message: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        if (this.cancelActiveSend === cancel) this.cancelActiveSend = undefined;
        if (error) reject(this.mapError(error));
        else resolve();
      };
      const cancel = () => finish(this.cancelled());
      const timer = setTimeout(() => finish(new XmaxError(XmaxErrorCode.timeout, "Agora room message send timed out")), 5000);
      this.cancelActiveSend = cancel;

      // run 同时接住同步异常和异步拒绝；即使取消或超时，底层结果仍有处理器。
      void this.run(() => client.sendStreamMessage(message, false)).then(() => finish(), finish);
    });
  }

  /**
   * 按滑动时间窗限速，退房立即唤醒等待并取消，不遗留计时器。
   */
  private async waitForSendBudget(bytes: number, version: number): Promise<void> {
    while (version === this.roomVersion) {
      const now = Date.now();
      this.sentPackets = this.sentPackets.filter(packet => now - packet.time < 1000);
      if (this.sentPackets.length < 30 && this.sentPackets.reduce((sum, packet) => sum + packet.bytes, bytes) <= 6000) return;
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); this.cancelSendDelay = undefined; resolve(); };
        const timer = setTimeout(finish, Math.max(1, this.sentPackets[0]!.time + 1000 - now));
        this.cancelSendDelay = finish;
      });
    }
    throw this.cancelled();
  }

  /**
   * 设置公共 RTC 监听器。
   */
  setEventListener(listener?: RtcEventListener): void { this.listener = listener; }

  /**
   * 将声网发布、DataStream、网络质量与 Token 事件桥接到公共传输层。
   */
  private registerEvents(client: AgoraDataStreamClient): void {
    const active = () => this.client === client && this.connection !== undefined && !this.rejoinTask;
    const mediaActive = () => active() && !this.tokenExpired;
    const handleExpired = () => {
      if (!active() || this.tokenExpired) return;
      this.tokenExpired = true;
      this.listener?.onTokenExpired?.();
    };
    client.on("user-published", (user, kind) => {
      if (!mediaActive()) return;
      if (kind === "video") this.listener?.onRemoteVideoPublished(String(user.uid), true);
      if (kind === "audio" && this.requestedAudio.has(String(user.uid))) {
        void this.subscribeRemoteAudio(String(user.uid), true).catch(error => {
          if (active()) this.listener?.onError?.(this.mapError(error));
        });
      }
    });
    client.on("user-unpublished", (user, kind) => {
      if (!mediaActive()) return;
      if (kind === "video") this.listener?.onRemoteVideoPublished(String(user.uid), false);
      if (kind === "audio") user.audioTrack?.stop();
    });
    client.on("user-left", user => {
      if (mediaActive()) this.listener?.onRemoteVideoPublished(String(user.uid), false);
    });
    client.on("stream-message", (uid, data) => {
      if (mediaActive()) this.listener?.onCustomMessageReceived(String(uid), typeof data === "string" ? data : new TextDecoder().decode(data));
    });
    client.on("network-quality", quality => {
      if (mediaActive()) AgoraRtcStatistics.network(quality, this.listener);
    });
    client.on("token-privilege-will-expire", () => {
      if (active() && !this.tokenExpired) this.listener?.onTokenWillExpire?.();
    });
    client.on("token-privilege-did-expire", handleExpired);
    client.on("connection-state-change", (state, previous, reason) => {
      // SDK 可能先报告因 Token 过期断开，再发 did-expire；合并成同一次恢复请求。
      if (state === "DISCONNECTED" && reason === "TOKEN_EXPIRE") {
        handleExpired();
        return;
      }
      if (active() && !this.tokenExpired && state === "DISCONNECTED" && previous !== "DISCONNECTED") {
        this.listener?.onError?.(new XmaxError(XmaxErrorCode.rtcError, `Agora connection disconnected: ${reason ?? "unknown"}`));
      }
    });
  }

  /**
   * 清理房间状态、播放和发送队列，不释放本地视频采集。
   */
  private clearRoom(): void {
    this.roomVersion++;
    this.cancelRejoin?.();
    this.connection = undefined;
    this.tokenExpired = false;
    this.videoPublishRequested = false;
    this.audioPublishRequested = false;
    clearInterval(this.statisticsTimer);
    this.statisticsTimer = undefined;
    this.cancelSendDelay?.();
    this.cancelActiveSend?.();
    this.sentPackets = [];
    this.sendTail = Promise.resolve();
    this.requestedAudio.clear();
    this.audioVolumes.clear();
    for (const user of this.client?.remoteUsers ?? []) user.audioTrack?.stop();
  }

  /**
   * 判断异步恢复工作是否仍属于当前房间生命周期。
   */
  private isRoomCurrent(client: AgoraDataStreamClient, version: number): boolean {
    return this.client === client && this.connection !== undefined && this.roomVersion === version;
  }

  /**
   * 退房、销毁或换房后停止后续恢复步骤。
   */
  private ensureRoomCurrent(client: AgoraDataStreamClient, version: number): void {
    if (!this.isRoomCurrent(client, version)) throw this.cancelled();
  }

  /**
   * 获取已初始化的 client。
   */
  private requireClient(): AgoraDataStreamClient {
    if (!this.client) throw new XmaxError(XmaxErrorCode.rtcError, "Agora is not initialized");
    return this.client;
  }

  /**
   * 获取已启动的相机采集。
   */
  private requireCamera(): ICameraVideoTrack {
    if (!this.camera) throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Camera capture is not running");
    return this.camera;
  }

  /**
   * 执行声网操作并统一错误类型。
   */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { throw this.mapError(error); }
  }

  /**
   * 只传递错误码，不回显可能包含 Token 的厂商原始错误消息。
   */
  private mapError(error: unknown, permissionCode?: XmaxErrorCode): XmaxError {
    if (error instanceof XmaxError) return error;
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
    const safeCode = /^[A-Z_0-9-]+$/.test(code) ? code : "UNKNOWN";
    return new XmaxError(permissionCode && safeCode === "PERMISSION_DENIED" ? permissionCode : XmaxErrorCode.rtcError, `Agora operation failed (${safeCode})`);
  }

  /**
   * 构造异步操作失效错误。
   */
  private cancelled(): XmaxError { return new XmaxError(XmaxErrorCode.cancelled, "Agora operation was cancelled"); }
}
