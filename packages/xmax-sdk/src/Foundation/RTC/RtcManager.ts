import { XmaxError, XmaxErrorCode } from "../Errors/XmaxError";
import type { NetworkQuality, TRTCStatistics } from "trtc-sdk-v5";
import { XmaxLogger } from "../Logging/XmaxLogger";
import { CameraPosition } from "../Media/Camera/CameraPosition";
import {
  RtcEngineManager,
  type RtcEngine,
  type RtcEngineLease,
} from "./RtcEngineManager";
import type { RtcEventListener } from "./RtcEventListener";
import type { NetworkQualityLevel } from "./NetworkStatistics";
import type { RoomJoinConfiguration } from "./RoomJoinConfiguration";
import type { RtcCameraCaptureOptions, RtcManaging } from "./RtcManaging";
import { RtcStatsLogger } from "./RtcStatsLogger";
import {
  RtcVideoEncoderPreference,
  type VideoEncodingConfiguration,
} from "./VideoEncodingConfiguration";

/** TRTC 事件名（字符串字面量，避免在非浏览器环境引用 TRTC 运行时常量）。 */
const RTC_EVENT = {
  remoteVideoAvailable: "remote-video-available",
  remoteVideoUnavailable: "remote-video-unavailable",
  customMessage: "custom-message",
  statistics: "statistics",
  networkQuality: "network-quality",
} as const;

/** TRTC 主流类型标识。 */
const STREAM_TYPE_MAIN = "main";

/** 房间自定义消息使用的 cmdId。 */
const CUSTOM_MESSAGE_CMD_ID = 1;

/** 房间自定义消息编码后的字节上限。 */
const ROOM_MESSAGE_MAX_BYTES = 1000;

/**
 * 采集启动时的占位码率（kbps）。
 *
 * 采集阶段不发布，该值不会生效到发送端；发布前由编码控制器按
 * 参考表计算的码率覆盖。
 */
const CAPTURE_PLACEHOLDER_BITRATE = 1000;

/** 编码策略偏好到 TRTC 弱网偏好的映射。 */
const QOS_PREFERENCE_MAP: Record<RtcVideoEncoderPreference, "smooth" | "clear"> = {
  [RtcVideoEncoderPreference.maintainFramerate]: "smooth",
  [RtcVideoEncoderPreference.maintainQuality]: "clear",
};

/** 引擎事件订阅需要的最小接口，用于隔离 TRTC 事件枚举类型。 */
interface RtcEventSource {
  on(event: string, handler: (event: never) => void): void;
  off(event: string, handler: (event: never) => void): void;
}

/** TRTC 远端视频事件的负载。 */
interface RtcRemoteVideoEvent {
  userId: string;
  streamType: string;
}

/** TRTC 自定义消息事件的负载。 */
interface RtcCustomMessageEvent {
  userId: string;
  cmdId: number;
  data: ArrayBuffer;
}

/**
 * 基于 TRTC 的 RTC 能力管理器。
 *
 * 采集由 TRTC 内部完成：`startLocalVideo({ publish: false })` 只采不发，
 * 浏览器兼容性差异交由 TRTC 适配；视频轨通过 `getVideoTrack()` 取出后
 * 交给 SDK 自己的渲染层预览。房间信令走自定义消息通道（`cmdId = 1`）。
 */
export class RtcManager implements RtcManaging {
  // 依赖
  private readonly engineManager: RtcEngineManager;

  // RTC 资源
  private lease?: RtcEngineLease;

  // 采集状态
  private isCapturing = false;
  private isAudioCapturing = false;

  // 房间状态
  private isInRoom = false;

  // 事件监听
  private eventListener?: RtcEventListener;
  private removeStatsListeners?: () => void;

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

  /** 初始化 RTC 引擎（获取独占租约）并注册事件桥接；已初始化时重复调用不产生效果。 */
  async initialize(): Promise<void> {
    if (this.lease) {
      return;
    }
    const lease = await this.engineManager.acquire();
    this.registerEventBridge(lease.engine);
    this.lease = lease;
  }

  /** 停止采集与发布、销毁 RTC 引擎并释放租约；未初始化时重复调用不产生效果。 */
  async destroy(): Promise<void> {
    const lease = this.lease;
    this.lease = undefined;
    this.eventListener = undefined;
    this.isCapturing = false;
    this.isAudioCapturing = false;
    this.isInRoom = false;
    this.removeStatsListeners?.();
    this.removeStatsListeners = undefined;
    if (!lease) {
      return;
    }
    try {
      await lease.engine.stopLocalAudio();
    } catch {
      // 引擎销毁前停止音频失败不影响租约释放。
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
            bitrate: CAPTURE_PLACEHOLDER_BITRATE,
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

  /**
   * 加入 RTC 房间。
   *
   * @throws 引擎未初始化、进房参数无效或进房失败时抛出错误。
   */
  async joinRoom(configuration: RoomJoinConfiguration): Promise<void> {
    const engine = this.requireEngine();
    const sdkAppId = Number(configuration.sdkAppID);
    if (!Number.isInteger(sdkAppId) || sdkAppId <= 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "RTC sdkAppID is invalid",
      );
    }
    if (this.isInRoom) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Already in an RTC room",
      );
    }
    try {
      await engine.enterRoom({
        sdkAppId,
        userId: configuration.userID,
        userSig: configuration.userSig,
        strRoomId: configuration.roomID,
        privateMapKey: configuration.privateMapKey,
      });
      this.isInRoom = true;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /** 离开当前 RTC 房间；未在房间中或引擎未初始化时不产生效果，退房失败仅记录日志。 */
  async leaveRoom(): Promise<void> {
    const engine = this.lease?.engine;
    if (!engine || !this.isInRoom) {
      return;
    }
    this.isInRoom = false;
    try {
      await engine.exitRoom();
    } catch (error) {
      XmaxLogger.rtc.warning(
        () =>
          `退出 RTC 房间失败 (Failed to Leave RTC Room)\n` +
          `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
      );
    }
  }

  /**
   * 配置本地视频编码参数。
   *
   * TRTC 只接受单一目标码率，以 `maximumBitrate` 作为目标码率；
   * 编码策略偏好映射为 TRTC 弱网偏好。
   *
   * @throws 摄像头采集未启动或编码参数配置失败时抛出错误。
   */
  async configureVideoEncoding(
    configuration: VideoEncodingConfiguration,
  ): Promise<void> {
    const engine = this.requireEngine();
    if (!this.isCapturing) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera capture is not running",
      );
    }
    try {
      await engine.updateLocalVideo({
        option: {
          profile: {
            width: configuration.width,
            height: configuration.height,
            frameRate: configuration.frameRate,
            bitrate: configuration.maximumBitrate,
          },
          qosPreference: QOS_PREFERENCE_MAP[configuration.encoderPreference],
        },
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * 发布本地视频流。
   *
   * @throws 摄像头采集未启动或发布失败时抛出错误。
   */
  async publishLocalVideo(): Promise<void> {
    const engine = this.requireEngine();
    if (!this.isCapturing) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera capture is not running",
      );
    }
    try {
      await engine.updateLocalVideo({ publish: true });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /** 停止发布本地视频流；采集保持运行，本地预览不受影响。 */
  async unpublishLocalVideo(): Promise<void> {
    const engine = this.lease?.engine;
    if (!engine || !this.isCapturing) {
      return;
    }
    try {
      await engine.updateLocalVideo({ publish: false });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * 发布本地音频流；首次调用时启动麦克风采集。
   *
   * @throws 引擎未初始化、麦克风权限被拒绝或发布失败时抛出错误。
   */
  async publishLocalAudio(): Promise<void> {
    const engine = this.requireEngine();
    try {
      if (!this.isAudioCapturing) {
        await engine.startLocalAudio();
        this.isAudioCapturing = true;
      } else {
        await engine.updateLocalAudio({ publish: true });
      }
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /** 停止发布本地音频流；麦克风采集保持运行。 */
  async unpublishLocalAudio(): Promise<void> {
    const engine = this.lease?.engine;
    if (!engine || !this.isAudioCapturing) {
      return;
    }
    try {
      await engine.updateLocalAudio({ publish: false });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * 更新远端视频主流订阅状态；订阅成功返回远端视频轨供渲染层绑定。
   *
   * @throws 引擎未初始化、订阅或停止订阅失败时抛出错误。
   */
  async subscribeRemoteVideo(
    userID: string,
    subscribe: boolean,
  ): Promise<MediaStreamTrack | undefined> {
    const engine = this.requireEngine();
    try {
      if (subscribe) {
        await engine.startRemoteVideo({
          userId: userID,
          streamType: STREAM_TYPE_MAIN as never,
        });
        const track = engine.getVideoTrack({ userId: userID });
        if (!track) {
          throw new XmaxError(
            XmaxErrorCode.mediaError,
            "Remote video track is not available",
          );
        }
        return track;
      }
      await engine.stopRemoteVideo({
        userId: userID,
        streamType: STREAM_TYPE_MAIN as never,
      });
      return undefined;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * 更新远端音频订阅状态。
   *
   * @throws 引擎未初始化或操作失败时抛出错误。
   */
  async subscribeRemoteAudio(userID: string, subscribe: boolean): Promise<void> {
    const engine = this.requireEngine();
    try {
      await engine.muteRemoteAudio(userID, !subscribe);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * 设置指定远端用户的音频播放音量。
   *
   * @param volume 音量，取值范围为 `0...100`，越界时收敛到边界。
   */
  setRemoteAudioVolume(volume: number, userID: string): void {
    const engine = this.requireEngine();
    const normalized = Math.min(Math.max(Math.round(volume), 0), 100);
    engine.setRemoteAudioVolume(userID, normalized);
  }

  /**
   * 向当前 RTC 房间发送自定义消息（`cmdId = 1`）。
   *
   * @throws 未在房间中或消息编码后超过 1000 字节时抛出错误。
   */
  sendRoomMessage(message: string): void {
    const engine = this.requireEngine();
    if (!this.isInRoom) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Not in an RTC room",
      );
    }
    const encoded = new TextEncoder().encode(message);
    if (encoded.byteLength > ROOM_MESSAGE_MAX_BYTES) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Room message exceeds the 1000-byte limit",
      );
    }
    engine.sendCustomMessage({
      cmdId: CUSTOM_MESSAGE_CMD_ID,
      data: encoded.buffer as ArrayBuffer,
    });
  }

  /** 设置 RTC 事件监听器，传入空值时清除监听器。 */
  setEventListener(listener?: RtcEventListener): void {
    this.eventListener = listener;
  }

  /** 注册引擎事件桥接：媒体、消息及性能日志。 */
  private registerEventBridge(engine: RtcEngine): void {
    const source = engine as unknown as RtcEventSource;
    // 直接使用 TRTC 的统计周期，不创建定时器；退房和旧引擎的迟到事件不输出。
    const onStatistics = (stats: TRTCStatistics) => {
      if (this.isInRoom && this.lease?.engine === engine) {
        RtcStatsLogger.logStatistics(stats);
        const video = stats.localStatistics?.video?.find((item) => item.videoType === "big");
        const valid = (value: number | undefined, minimum: number) =>
          typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : undefined;
        this.eventListener?.onLocalVideoStatistics?.(video ? Object.freeze({
          width: valid(video.width, 1),
          height: valid(video.height, 1),
          frameRate: valid(video.frameRate, 0),
          bitrateKbps: valid(video.bitrate, 0),
        }) : undefined);
        this.eventListener?.onRemoteVideoStatistics?.(Object.freeze(
          (stats.remoteStatistics ?? []).flatMap((remote) => {
            const video = remote.video?.find((item) => item.videoType === "big");
            if (!video) {
              return [];
            }
            // 当前 TRTC 类型声明漏了这个可选运行时字段，缺失时不以缓冲延迟替代。
            const playback = video as typeof video & { point2pointDelay?: number; jitterBufferDelay?: number };
            return [Object.freeze({
              userID: remote.userId,
              width: valid(video.width, 1),
              height: valid(video.height, 1),
              frameRate: valid(video.frameRate, 0),
              bitrateKbps: valid(video.bitrate, 0),
              rttMs: valid(stats.rtt, 0),
              uplinkLossPercent: stats.upLoss <= 100 ? valid(stats.upLoss, 0) : undefined,
              downlinkLossPercent: stats.downLoss <= 100 ? valid(stats.downLoss, 0) : undefined,
              jitterBufferDelayMs: valid(playback.jitterBufferDelay, 0),
              endToEndDelayMs: valid(playback.point2pointDelay, 0),
            })];
          }),
        ));
      }
    };
    const onNetworkQuality = (stats: NetworkQuality) => {
      if (this.isInRoom && this.lease?.engine === engine) {
        RtcStatsLogger.logNetworkQuality(stats);
        const quality = (value: number) =>
          Number.isInteger(value) && value >= 0 && value <= 6
            ? value as NetworkQualityLevel : undefined;
        const rtt = (value: number) =>
          Number.isFinite(value) && value >= 0 ? value : undefined;
        this.eventListener?.onNetworkStatistics?.(Object.freeze({
          uplinkQuality: quality(stats.uplinkNetworkQuality),
          downlinkQuality: quality(stats.downlinkNetworkQuality),
          uplinkRttMs: rtt(stats.uplinkRTT),
          downlinkRttMs: rtt(stats.downlinkRTT),
        }));
      }
    };
    source.on(RTC_EVENT.statistics, onStatistics);
    source.on(RTC_EVENT.networkQuality, onNetworkQuality);
    this.removeStatsListeners = () => {
      source.off(RTC_EVENT.statistics, onStatistics);
      source.off(RTC_EVENT.networkQuality, onNetworkQuality);
    };
    source.on(RTC_EVENT.remoteVideoAvailable, (event: RtcRemoteVideoEvent) => {
      if (event.streamType !== STREAM_TYPE_MAIN) {
        return;
      }
      this.eventListener?.onRemoteVideoPublished(event.userId, true);
    });
    source.on(RTC_EVENT.remoteVideoUnavailable, (event: RtcRemoteVideoEvent) => {
      if (event.streamType !== STREAM_TYPE_MAIN) {
        return;
      }
      this.eventListener?.onRemoteVideoPublished(event.userId, false);
    });
    source.on(RTC_EVENT.customMessage, (event: RtcCustomMessageEvent) => {
      if (event.cmdId !== CUSTOM_MESSAGE_CMD_ID) {
        return;
      }
      let message: string;
      try {
        message = new TextDecoder().decode(event.data);
      } catch {
        XmaxLogger.rtc.warning(() => "自定义消息解码失败 (Failed to Decode Custom Message)");
        return;
      }
      this.eventListener?.onCustomMessageReceived(event.userId, message);
    });
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
}
