import type { IRTCEngine } from "@volcengine/rtc";
import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { XmaxLogger, XmaxLoggerOption } from "../../Logging/XmaxLogger";
import { CameraPosition } from "../../Media/Camera/CameraPosition";
import type { RtcManaging, RtcCameraCaptureOptions } from "../RtcManaging";
import type { RtcEventListener } from "../RtcEventListener";
import type { RtcRoomJoinConfiguration, VeRtcRoomJoinConfiguration } from "../RoomJoinConfiguration";
import { RtcVideoEncoderPreference, type VideoEncodingConfiguration } from "../VideoEncodingConfiguration";
import { rtcOrientedVideoSize } from "../RtcVideoOrientation";
import type { RemoteVideoStatistics } from "../VideoStatistics";
import { VeRtcStatistics } from "./VeRtcStatistics";

type VeRtcSDK = typeof import("@volcengine/rtc");
export const VERTC_APP_ID = "69a177e226e9b90176a86b96";

export interface VeRtcManagerOptions {
  loadSDK?: () => Promise<VeRtcSDK>;
}

/** SDK 内部采集、房间文本信令；原生媒体轨道复用公共渲染层。 */
export class VeRtcManager implements RtcManaging {
  private readonly loadSDK: () => Promise<VeRtcSDK>;
  private sdk?: VeRtcSDK;
  private engine?: IRTCEngine;
  private initialization?: Promise<void>;
  private lifecycle = 0;
  private captureVersion = 0;
  private camera?: MediaStreamTrack;
  private microphone = false;
  private connection?: VeRtcRoomJoinConfiguration;
  private joined = false;
  private roomVersion = 0;
  private roomAbort = new AbortController();
  private recovery?: Promise<void>;
  private joining?: Promise<void>;
  private tokenExpired = false;
  private publishPrivilegeExpired = false;
  private subscribePrivilegeExpired = false;
  private videoRequested = false;
  private audioRequested = false;
  private listener?: RtcEventListener;
  private readonly publishedVideo = new Set<string>();
  private readonly publishedAudio = new Set<string>();
  private readonly requestedVideo = new Set<string>();
  private readonly requestedAudio = new Set<string>();
  private readonly audioVolumes = new Map<string, number>();
  private readonly audioPlayers = new Map<string, HTMLAudioElement>();
  private readonly audioSubscriptions = new Map<string, object>();
  private readonly remoteStatistics = new Map<string, RemoteVideoStatistics>();
  private uplinkLossPercent?: number;

  constructor(options: VeRtcManagerOptions = {}) {
    this.loadSDK = options.loadSDK ?? (() => import("@volcengine/rtc"));
  }

  get isInitialized(): boolean { return this.engine !== undefined; }

  get supportsRemoteAudioVolumeControl(): boolean {
    if (typeof navigator === "undefined") return true;
    return !(/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
  }

  async initialize(): Promise<void> {
    if (this.engine) return;
    if (this.initialization) return this.initialization;
    const version = this.lifecycle;
    const operation = (async () => {
      const sdk = await this.loadSDK();
      if (version !== this.lifecycle) throw this.cancelled();
      sdk.default.setLogConfig({ logLevel: "none" });
      // 禁用厂商自动播放；视频交给公共 View，音频按当前音量显式播放，避免初始漏声。
      const engine = sdk.default.createEngine(VERTC_APP_ID, { autoPlayPolicy: sdk.RTCAutoPlayPolicy.PLAY_MANUALLY });
      this.sdk = sdk;
      this.engine = engine;
      this.registerEvents(engine);
    })();
    this.initialization = operation;
    try { await operation; }
    finally { if (this.initialization === operation) this.initialization = undefined; }
  }

  async destroy(): Promise<void> {
    this.lifecycle++;
    this.captureVersion++;
    const engine = this.engine;
    const sdk = this.sdk;
    this.listener = undefined;
    this.clearRoom();
    this.engine = undefined;
    this.sdk = undefined;
    this.camera = undefined;
    this.microphone = false;
    engine?.removeAllListeners();
    if (engine && sdk) sdk.default.destroyEngine(engine);
  }

  async startCameraCapture(options: RtcCameraCaptureOptions): Promise<MediaStreamTrack> {
    const engine = this.requireEngine();
    if (this.camera) throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Camera capture is already running");
    const version = ++this.captureVersion;
    await this.run(() => engine.setVideoEncoderConfig({
      ...rtcOrientedVideoSize({ width: options.width, height: options.height }), frameRate: options.frameRate, maxKbps: 1000,
      preferCodecName: this.sdk!.VideoCodecType.H264, contentHint: "motion",
    }));
    if (engine !== this.engine || version !== this.captureVersion) throw this.cancelled();
    try {
      await engine.startVideoCapture(options.position === CameraPosition.front ? "user" : "environment");
      if (engine !== this.engine || version !== this.captureVersion) {
        await engine.stopVideoCapture().catch(() => {});
        throw this.cancelled();
      }
      const track = engine.getLocalStreamTrack(this.sdk!.StreamIndex.STREAM_INDEX_MAIN, "video");
      if (!track) {
        await engine.stopVideoCapture();
        throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC camera track is unavailable");
      }
      this.camera = track;
      return track;
    } catch (error) { throw this.mapError(error, XmaxErrorCode.cameraPermissionDenied); }
  }

  async switchCameraCapture(to: CameraPosition): Promise<MediaStreamTrack> {
    const engine = this.requireEngine();
    this.requireCamera();
    const version = this.captureVersion;
    await this.run(() => engine.setVideoCaptureDevice(to === CameraPosition.front ? "user" : "environment"));
    if (engine !== this.engine || version !== this.captureVersion) throw this.cancelled();
    const track = engine.getLocalStreamTrack(this.sdk!.StreamIndex.STREAM_INDEX_MAIN, "video");
    if (!track) throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC camera track is unavailable");
    this.camera = track;
    return track;
  }

  async stopCameraCapture(): Promise<void> {
    this.captureVersion++;
    this.camera = undefined;
    if (this.engine) await this.run(() => this.engine!.stopVideoCapture());
  }

  async configureVideoEncoding(config: VideoEncodingConfiguration): Promise<void> {
    const engine = this.requireEngine();
    this.requireCamera();
    await this.run(() => engine.setVideoEncoderConfig({
      ...rtcOrientedVideoSize({ width: config.width, height: config.height }), frameRate: config.frameRate, maxKbps: config.maximumBitrate,
      contentHint: config.encoderPreference === RtcVideoEncoderPreference.maintainFramerate ? "motion" : "detail",
      preferCodecName: this.sdk!.VideoCodecType.H264,
    }));
  }

  async joinRoom(config: RtcRoomJoinConfiguration): Promise<void> {
    await this.joining?.catch(() => {});
    await this.recovery?.catch(() => {});
    const engine = this.requireEngine();
    if (config.provider !== "vertc" || config.appID !== VERTC_APP_ID || this.connection) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "VeRTC credentials for the configured AppID and an idle room are required");
    }
    this.clearRoom();
    this.connection = config;
    const version = this.roomVersion;
    const task = this.performJoin(engine, config, version);
    this.joining = task;
    try { await task; }
    finally { if (this.joining === task) this.joining = undefined; }
  }

  private async performJoin(engine: IRTCEngine, config: VeRtcRoomJoinConfiguration, version: number): Promise<void> {
    try {
      await this.enter(engine, config);
      if (!this.isCurrent(engine, version)) {
        await engine.leaveRoom().catch(() => {});
        throw this.cancelled();
      }
      this.joined = true;
      this.replayVideo();
    } catch (error) {
      if (this.isCurrent(engine, version)) this.clearRoom();
      throw this.mapError(error);
    }
  }

  private enter(engine: IRTCEngine, config: VeRtcRoomJoinConfiguration): Promise<void> {
    return this.run(() => engine.joinRoom(config.roomToken, config.roomID, { userId: config.userID }, {
      isAutoPublish: false, isAutoSubscribeAudio: false, isAutoSubscribeVideo: false,
      roomProfileType: this.sdk!.RoomProfileType.communication,
    }));
  }

  async leaveRoom(): Promise<void> {
    const engine = this.engine;
    this.clearRoom();
    if (engine) await this.run(() => engine.leaveRoom());
  }

  /** 正常续签仅 updateToken；被移出房间后重进，恢复发布与订阅意图。 */
  async updateCredentials(config: RtcRoomJoinConfiguration, signal?: AbortSignal): Promise<void> {
    const engine = this.requireEngine();
    const current = this.connection;
    if (signal?.aborted) throw this.cancelled();
    if (!current || config.provider !== "vertc" || config.appID !== current.appID || config.roomID !== current.roomID || config.userID !== current.userID) {
      throw new XmaxError(XmaxErrorCode.sessionError, "VeRTC session binding changed");
    }
    const version = this.roomVersion;
    if (this.recovery) await this.cancellable(this.recovery, signal);
    if (!this.isCurrent(engine, version)) throw this.cancelled();
    const task = this.renew(engine, config, version);
    this.recovery = task;
    void task.finally(() => { if (this.recovery === task) this.recovery = undefined; }).catch(() => {});
    await this.cancellable(task, signal);
  }

  private async renew(engine: IRTCEngine, config: VeRtcRoomJoinConfiguration, version: number): Promise<void> {
    if (!this.tokenExpired) {
      try { await this.run(() => engine.updateToken(config.roomToken)); }
      catch (error) { this.ensureCurrent(engine, version); if (!this.tokenExpired) throw error; }
    }
    this.ensureCurrent(engine, version);
    const restore = this.tokenExpired || this.publishPrivilegeExpired || this.subscribePrivilegeExpired;
    if (restore) {
      this.joined = false;
      this.listener?.onRoomRejoining?.();
      this.clearPlayers();
      this.clearStatistics();
      if (this.tokenExpired) {
        this.publishedVideo.clear();
        this.publishedAudio.clear();
        await this.run(() => engine.leaveRoom());
        this.ensureCurrent(engine, version);
        await this.enter(engine, config);
        if (!this.isCurrent(engine, version)) {
          await engine.leaveRoom().catch(() => {});
          throw this.cancelled();
        }
      }
      if ((this.tokenExpired || this.publishPrivilegeExpired) && this.videoRequested && this.camera) {
        await this.run(() => engine.publishStream(this.sdk!.MediaType.VIDEO));
        this.ensureCurrent(engine, version);
        if (!this.videoRequested) {
          await this.run(() => engine.unpublishStream(this.sdk!.MediaType.VIDEO));
          this.ensureCurrent(engine, version);
        }
      }
      if ((this.tokenExpired || this.publishPrivilegeExpired) && this.audioRequested && this.microphone) {
        await this.run(() => engine.publishStream(this.sdk!.MediaType.AUDIO));
        this.ensureCurrent(engine, version);
        if (!this.audioRequested) {
          await this.run(() => engine.unpublishStream(this.sdk!.MediaType.AUDIO));
          this.ensureCurrent(engine, version);
        }
      }
    }
    this.connection = config;
    this.tokenExpired = false;
    this.publishPrivilegeExpired = false;
    this.subscribePrivilegeExpired = false;
    this.joined = true;
    if (restore) {
      this.replayVideo();
      for (const userID of this.requestedAudio) {
        if (this.publishedAudio.has(userID)) await this.subscribeRemoteAudio(userID, true);
        this.ensureCurrent(engine, version);
      }
    }
  }

  async publishLocalVideo(): Promise<void> {
    const engine = this.requireEngine();
    this.requireCamera();
    this.videoRequested = true;
    const version = this.roomVersion;
    await this.recovery;
    this.ensureCurrent(engine, version);
    if (!this.videoRequested) throw this.cancelled();
    await this.run(() => engine.publishStream(this.sdk!.MediaType.VIDEO));
  }

  async unpublishLocalVideo(): Promise<void> {
    this.videoRequested = false;
    if (this.joined && !this.tokenExpired) await this.run(() => this.requireEngine().unpublishStream(this.sdk!.MediaType.VIDEO));
  }

  async publishLocalAudio(): Promise<void> {
    const engine = this.requireEngine();
    this.audioRequested = true;
    const version = this.roomVersion;
    await this.recovery;
    this.ensureCurrent(engine, version);
    try {
      if (!this.microphone) {
        await engine.startAudioCapture();
        if (!this.isCurrent(engine, version)) {
          await engine.stopAudioCapture().catch(() => {});
          throw this.cancelled();
        }
        this.microphone = true;
      }
      if (!this.audioRequested) throw this.cancelled();
      await engine.publishStream(this.sdk!.MediaType.AUDIO);
    } catch (error) { throw this.mapError(error, XmaxErrorCode.microphonePermissionDenied); }
  }

  async unpublishLocalAudio(): Promise<void> {
    this.audioRequested = false;
    if (this.joined && !this.tokenExpired) await this.run(() => this.requireEngine().unpublishStream(this.sdk!.MediaType.AUDIO));
  }

  async subscribeRemoteVideo(userID: string, subscribe: boolean): Promise<MediaStreamTrack | undefined> {
    const engine = this.requireEngine();
    const version = this.roomVersion;
    if (!subscribe) {
      this.requestedVideo.delete(userID);
      this.remoteStatistics.delete(userID);
      this.emitRemoteStatistics();
      if (this.joined && !this.tokenExpired) await this.run(() => engine.unsubscribeStream(userID, this.sdk!.MediaType.VIDEO));
      return;
    }
    this.requestedVideo.add(userID);
    await this.run(() => engine.subscribeStream(userID, this.sdk!.MediaType.VIDEO));
    this.ensureCurrent(engine, version);
    if (!this.requestedVideo.has(userID)) return;
    const track = engine.getRemoteStreamTrack(userID, this.sdk!.StreamIndex.STREAM_INDEX_MAIN, "video");
    if (!track) throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC remote video track is unavailable");
    return track;
  }

  async subscribeRemoteAudio(userID: string, subscribe: boolean): Promise<void> {
    const engine = this.requireEngine();
    const version = this.roomVersion;
    if (!subscribe) {
      this.requestedAudio.delete(userID);
      this.clearPlayer(userID);
      if (this.joined && !this.tokenExpired && this.publishedAudio.has(userID)) await this.run(() => engine.unsubscribeStream(userID, this.sdk!.MediaType.AUDIO));
      return;
    }
    this.requestedAudio.add(userID);
    if (!this.joined || this.tokenExpired || !this.publishedAudio.has(userID)) return;
    const subscription = {};
    this.audioSubscriptions.set(userID, subscription);
    await this.run(() => engine.subscribeStream(userID, this.sdk!.MediaType.AUDIO));
    if (!this.isCurrent(engine, version) || !this.joined || this.tokenExpired ||
      this.audioSubscriptions.get(userID) !== subscription ||
      !this.requestedAudio.has(userID) || !this.publishedAudio.has(userID)) return;
    const track = engine.getRemoteStreamTrack(userID, this.sdk!.StreamIndex.STREAM_INDEX_MAIN, "audio");
    if (!track) return;
    this.clearPlayer(userID);
    const player = document.createElement("audio");
    player.srcObject = new MediaStream([track]);
    this.audioPlayers.set(userID, player);
    this.applyAudioVolume(userID);
  }

  setRemoteAudioVolume(volume: number, userID: string): void {
    this.audioVolumes.set(userID, Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : 0);
    this.applyAudioVolume(userID);
  }

  private applyAudioVolume(userID: string): void {
    const player = this.audioPlayers.get(userID);
    if (!player) return;
    const volume = this.audioVolumes.get(userID) ?? 0;
    player.muted = volume === 0 || !this.requestedAudio.has(userID);
    if (this.supportsRemoteAudioVolumeControl) player.volume = volume / 100;
    if (player.muted) player.pause();
    else void player.play().catch(() => {
      XmaxLogger.rtc.warning(() => "VeRTC audio playback requires a user interaction");
    });
  }

  async sendRoomMessage(message: string): Promise<void> {
    const engine = this.requireEngine();
    const version = this.roomVersion;
    if (!this.joined || this.tokenExpired) throw this.cancelled();
    if (new TextEncoder().encode(message).byteLength > 64 * 1024) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "VeRTC room message exceeds the 64-KiB limit");
    }
    // 不添加包装、不拆包；保留公共 RoomEvent 原始 JSON。
    await this.cancellable(this.run(async () => {
      const sent = engine.sendRoomMessage(message);
      if (!sent) throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC room message was not sent");
      await sent;
    }), undefined, 5000);
    this.ensureCurrent(engine, version);
  }

  setEventListener(listener?: RtcEventListener): void { this.listener = listener; }

  private registerEvents(engine: IRTCEngine): void {
    const events = this.sdk!.default.events;
    const active = () => engine === this.engine && this.connection !== undefined;
    const mediaActive = () => active() && this.joined && !this.tokenExpired;
    const video = (mediaType: number) => (mediaType & this.sdk!.MediaType.VIDEO) !== 0;
    const audio = (mediaType: number) => (mediaType & this.sdk!.MediaType.AUDIO) !== 0;
    engine.on(events.onUserPublishStream, ({ userId, mediaType }) => {
      if (!active()) return;
      if (video(mediaType)) {
        this.publishedVideo.add(userId);
        if (mediaActive()) this.listener?.onRemoteVideoPublished(userId, true);
      }
      if (audio(mediaType)) {
        this.publishedAudio.add(userId);
        if (mediaActive() && this.requestedAudio.has(userId)) {
          void this.subscribeRemoteAudio(userId, true).catch(error => {
            if (mediaActive()) this.listener?.onError?.(this.mapError(error));
          });
        }
      }
    });
    engine.on(events.onUserUnpublishStream, ({ userId, mediaType }) => {
      if (!active()) return;
      if (video(mediaType)) this.removeVideo(userId);
      if (audio(mediaType)) { this.publishedAudio.delete(userId); this.clearPlayer(userId); }
    });
    engine.on(events.onUserLeave, ({ userInfo }) => {
      if (!active()) return;
      this.removeVideo(userInfo.userId);
      this.publishedAudio.delete(userInfo.userId);
      this.clearPlayer(userInfo.userId);
    });
    engine.on(events.onRoomMessageReceived, ({ userId, message }) => {
      if (mediaActive() && typeof message === "string") this.listener?.onCustomMessageReceived(userId, message);
    });
    const willExpire = () => { if (active()) this.listener?.onTokenWillExpire?.(); };
    engine.on(events.onTokenWillExpire, willExpire);
    engine.on(events.onTokenPublishPrivilegeWillExpire, willExpire);
    engine.on(events.onTokenSubscribePrivilegeWillExpire, willExpire);
    engine.on(events.onTokenPublishPrivilegeDidExpired, () => {
      if (!active() || this.publishPrivilegeExpired) return;
      this.publishPrivilegeExpired = true;
      this.listener?.onTokenExpired?.();
    });
    engine.on(events.onTokenSubscribePrivilegeDidExpired, () => {
      if (!active() || this.subscribePrivilegeExpired) return;
      this.subscribePrivilegeExpired = true;
      this.clearPlayers();
      this.listener?.onTokenExpired?.();
    });
    engine.on(events.onError, ({ errorCode }) => {
      if (!active()) return;
      if (errorCode === "TOKEN_EXPIRED") {
        if (this.tokenExpired) return;
        this.tokenExpired = true;
        this.clearPlayers();
        this.listener?.onTokenExpired?.();
      } else this.listener?.onError?.(this.mapError({ code: errorCode }));
    });
    // 网络断线由厂商自动恢复，避免自行重复 join。恢复后重新绑定可能替换的轨道。
    engine.on(events.onConnectionStateChanged, ({ state }) => {
      if (!mediaActive() || state !== this.sdk!.ConnectionState.CONNECTION_STATE_RECONNECTED) return;
      this.listener?.onRoomRejoining?.();
      this.clearPlayers();
      this.clearStatistics();
      this.replayVideo();
      for (const userID of this.requestedAudio) {
        void this.subscribeRemoteAudio(userID, true).catch(error => {
          if (mediaActive()) this.listener?.onError?.(this.mapError(error));
        });
      }
    });
    engine.on(events.onNetworkQuality, (up, down) => {
      if (mediaActive()) this.listener?.onNetworkStatistics?.(Object.freeze({
        uplinkQuality: VeRtcStatistics.quality(up), downlinkQuality: VeRtcStatistics.quality(down),
      }));
    });
    engine.on(events.onLocalStreamStats, stats => {
      if (!mediaActive() || stats.isScreen || !this.videoRequested) return;
      const result = VeRtcStatistics.local(stats.videoStats);
      this.uplinkLossPercent = result.uplinkLossPercent;
      this.listener?.onLocalVideoStatistics?.(result);
      XmaxLogger.rtc.info(() => `VeRTC local video statistics: ${JSON.stringify(result)}`, XmaxLoggerOption.performance);
    });
    engine.on(events.onRemoteStreamStats, stats => {
      if (!mediaActive() || stats.isScreen || !this.requestedVideo.has(stats.userId)) return;
      this.remoteStatistics.set(stats.userId, VeRtcStatistics.remote(stats.userId, stats.videoStats, this.uplinkLossPercent));
      this.emitRemoteStatistics();
    });
  }

  private replayVideo(): void {
    for (const userID of this.publishedVideo) this.listener?.onRemoteVideoPublished(userID, true);
  }

  private removeVideo(userID: string): void {
    this.publishedVideo.delete(userID);
    this.remoteStatistics.delete(userID);
    this.emitRemoteStatistics();
    if (this.joined && !this.tokenExpired) this.listener?.onRemoteVideoPublished(userID, false);
  }

  private emitRemoteStatistics(): void {
    this.listener?.onRemoteVideoStatistics?.(Object.freeze([...this.remoteStatistics.values()]));
  }

  private clearStatistics(): void {
    this.remoteStatistics.clear();
    this.uplinkLossPercent = undefined;
    this.listener?.onLocalVideoStatistics?.(undefined);
    this.emitRemoteStatistics();
  }

  private clearPlayer(userID: string): void {
    this.audioSubscriptions.delete(userID);
    const player = this.audioPlayers.get(userID);
    if (player) { player.pause(); player.srcObject = null; }
    this.audioPlayers.delete(userID);
  }

  private clearPlayers(): void {
    this.audioSubscriptions.clear();
    for (const userID of this.audioPlayers.keys()) this.clearPlayer(userID);
  }

  private clearRoom(): void {
    this.roomVersion++;
    this.roomAbort.abort();
    this.roomAbort = new AbortController();
    this.connection = undefined;
    this.joined = false;
    this.tokenExpired = false;
    this.publishPrivilegeExpired = false;
    this.subscribePrivilegeExpired = false;
    this.videoRequested = false;
    this.audioRequested = false;
    this.publishedVideo.clear();
    this.publishedAudio.clear();
    this.requestedVideo.clear();
    this.requestedAudio.clear();
    this.audioVolumes.clear();
    this.clearPlayers();
    this.clearStatistics();
  }

  /** 业务取消立即结束等待；底层迟到结果由版本检查清理。 */
  private async cancellable<T>(task: Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
    const roomSignal = this.roomAbort.signal;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
        cleanup(); reject(new XmaxError(XmaxErrorCode.timeout, "VeRTC room message send timed out"));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        roomSignal.removeEventListener("abort", cancel);
        signal?.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        // 外部取消使续签后续步骤失效，但由正常退房流程释放所有资源。
        if (signal?.aborted && !roomSignal.aborted) this.roomVersion++;
        cleanup(); reject(this.cancelled());
      };
      roomSignal.addEventListener("abort", cancel, { once: true });
      signal?.addEventListener("abort", cancel, { once: true });
      task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      if (roomSignal.aborted || signal?.aborted) cancel();
    });
  }

  private isCurrent(engine: IRTCEngine, version: number): boolean {
    return this.engine === engine && this.connection !== undefined && this.roomVersion === version;
  }

  private ensureCurrent(engine: IRTCEngine, version: number): void {
    if (!this.isCurrent(engine, version)) throw this.cancelled();
  }

  private requireEngine(): IRTCEngine {
    if (!this.engine) throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC is not initialized");
    return this.engine;
  }

  private requireCamera(): MediaStreamTrack {
    if (!this.camera) throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Camera capture is not running");
    return this.camera;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) { throw this.mapError(error); }
  }

  private mapError(error: unknown, permissionCode?: XmaxErrorCode): XmaxError {
    if (error instanceof XmaxError) return error;
    const value = error as { code?: unknown; name?: unknown } | null;
    const code = typeof value?.code === "string" && /^[A-Z_0-9-]{1,64}$/.test(value.code) ? value.code : "UNKNOWN";
    const denied = value?.name === "NotAllowedError" || code === "PERMISSION_DENIED" || code === "DEVICE_PERMISSION_DENIED";
    return new XmaxError(permissionCode && denied ? permissionCode : XmaxErrorCode.rtcError, `VeRTC operation failed (${code})`);
  }

  private cancelled(): XmaxError { return new XmaxError(XmaxErrorCode.cancelled, "VeRTC operation was cancelled"); }
}
