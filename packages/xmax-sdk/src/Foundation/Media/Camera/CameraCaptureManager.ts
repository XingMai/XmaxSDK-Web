import { XmaxError, XmaxErrorCode, type XmaxErrorListener } from "../../Errors/XmaxError";
import { XmaxLogger } from "../../Logging/XmaxLogger";
import { CameraPosition } from "./CameraPosition";
import type {
  CameraCaptureManaging,
  CameraCaptureStartOptions,
} from "./CameraCaptureManaging";

/** 摄像头位置到 getUserMedia facingMode 的映射。 */
function facingMode(position: CameraPosition): "user" | "environment" {
  return position === CameraPosition.front ? "user" : "environment";
}

/**
 * 使用 getUserMedia 采集视频。
 *
 * 切换摄像头时复用同一个 `MediaStream`（旧轨移除、新轨加入），
 * 已绑定该流的 `<video>` 预览无需重新挂载。
 */
export class CameraCaptureManager implements CameraCaptureManaging {
  // 平台资源
  private stream?: MediaStream;
  private videoTrack?: MediaStreamTrack;

  // 事件监听
  private errorListener?: XmaxErrorListener;
  private onTrackEnded?: () => void;

  /** 当前采集使用的媒体流；未启动时为空。 */
  get mediaStream(): MediaStream | undefined {
    return this.stream;
  }

  /** 当前采集的视频轨；未启动时为空。 */
  get currentVideoTrack(): MediaStreamTrack | undefined {
    return this.videoTrack;
  }

  /**
   * 启动摄像头采集。
   *
   * @param options 采集尺寸、帧率、摄像头位置与事件回调。
   * @returns 采集到的视频轨。
   * @throws 已在采集、参数无效、设备不可用或权限被拒绝时抛出错误。
   */
  async start(options: CameraCaptureStartOptions): Promise<MediaStreamTrack> {
    if (this.videoTrack) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Camera capture is already running",
      );
    }
    if (
      options.frameRate <= 0 ||
      options.width <= 0 ||
      options.height <= 0 ||
      options.width % 2 !== 0 ||
      options.height % 2 !== 0
    ) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Camera capture format is invalid",
      );
    }

    const track = await this.capture(options);
    const stream = new MediaStream([track]);
    this.stream = stream;
    this.videoTrack = track;
    this.errorListener = options.errorListener;
    this.observeTrack(track, options.firstFrameListener);
    return track;
  }

  /**
   * 在前置和后置摄像头之间切换，复用当前媒体流。
   *
   * @param to 目标摄像头位置。
   * @returns 切换后的视频轨。
   * @throws 采集未启动或设备切换失败时抛出错误。
   */
  async switchCamera(to: CameraPosition): Promise<MediaStreamTrack> {
    const currentStream = this.stream;
    const currentTrack = this.videoTrack;
    if (!currentStream || !currentTrack) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Camera capture is not running",
      );
    }

    const settings = currentTrack.getSettings();
    const nextTrack = await this.capture({
      width: settings.width ?? 0,
      height: settings.height ?? 0,
      frameRate: Math.round(settings.frameRate ?? 0),
      position: to,
      firstFrameListener: () => {},
      errorListener: () => {},
    });

    // 先拿到新设备再替换，失败时旧采集不受影响。
    this.unobserveTrack(currentTrack);
    currentStream.removeTrack(currentTrack);
    currentTrack.stop();
    currentStream.addTrack(nextTrack);
    this.videoTrack = nextTrack;
    this.observeTrack(nextTrack, () => {});
    return nextTrack;
  }

  /** 停止采集并释放设备。 */
  async stop(): Promise<void> {
    const stream = this.stream;
    this.stream = undefined;
    this.videoTrack = undefined;
    this.errorListener = undefined;
    if (!stream) {
      return;
    }
    for (const track of stream.getTracks()) {
      this.unobserveTrack(track);
      track.stop();
    }
  }

  /**
   * 按采集参数向浏览器申请摄像头并返回视频轨。
   *
   * @throws 权限被拒绝或设备不可用时抛出映射后的 `XmaxError`。
   */
  private async capture(
    options: CameraCaptureStartOptions,
  ): Promise<MediaStreamTrack> {
    const video: MediaTrackConstraints = {
      facingMode: { ideal: facingMode(options.position) },
    };
    if (options.width > 0) {
      video.width = { ideal: options.width };
    }
    if (options.height > 0) {
      video.height = { ideal: options.height };
    }
    if (options.frameRate > 0) {
      video.frameRate = { ideal: options.frameRate, max: options.frameRate };
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video,
      });
    } catch (error) {
      throw CameraCaptureManager.mapCaptureError(error);
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      for (const audioTrack of stream.getTracks()) {
        audioTrack.stop();
      }
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "The requested camera is unavailable",
      );
    }
    return track;
  }

  /** 监听视频轨的首帧到达（unmute）与意外中断（ended）事件。 */
  private observeTrack(track: MediaStreamTrack, onFirstFrame: () => void): void {
    let firstFrameNotified = false;
    const notifyFirstFrame = (): void => {
      if (firstFrameNotified) {
        return;
      }
      firstFrameNotified = true;
      onFirstFrame();
    };

    // track 的 unmute 事件标志首个有效帧到达；已就绪的轨直接通知。
    if (!track.muted && track.readyState === "live") {
      queueMicrotask(notifyFirstFrame);
    } else {
      track.addEventListener("unmute", notifyFirstFrame, { once: true });
    }

    this.onTrackEnded = () => {
      XmaxLogger.media.error(
        () => "摄像头采集中断 (Camera Capture Ended Unexpectedly)",
      );
      this.errorListener?.(
        new XmaxError(XmaxErrorCode.mediaError, "Camera capture ended"),
      );
    };
    track.addEventListener("ended", this.onTrackEnded);
  }

  /** 移除视频轨上的事件监听。 */
  private unobserveTrack(track: MediaStreamTrack): void {
    if (this.onTrackEnded) {
      track.removeEventListener("ended", this.onTrackEnded);
      this.onTrackEnded = undefined;
    }
  }

  /** 将 getUserMedia 的 DOMException 映射为 SDK 统一错误。 */
  private static mapCaptureError(error: unknown): XmaxError {
    if (error instanceof DOMException) {
      switch (error.name) {
        case "NotAllowedError":
        case "SecurityError":
          return new XmaxError(
            XmaxErrorCode.cameraPermissionDenied,
            "Camera permission was denied",
          );
        case "NotFoundError":
        case "OverconstrainedError":
          return new XmaxError(
            XmaxErrorCode.mediaError,
            "The requested camera is unavailable",
          );
        case "NotReadableError":
        case "AbortError":
          return new XmaxError(
            XmaxErrorCode.mediaError,
            "Camera capture failed to start",
          );
        default:
          break;
      }
    }
    return XmaxError.from(error);
  }
}
