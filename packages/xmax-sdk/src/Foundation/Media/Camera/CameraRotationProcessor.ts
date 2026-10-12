import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import type { CameraRotation } from "./CameraRotation";

/**
 * 将摄像头原始帧旋转为固定目标尺寸，供预览和 RTC 共用。
 * 只持有输入轨引用，不关闭摄像头；拥有输出轨和帧调度资源。
 */
export class CameraRotationProcessor {
  private readonly video = document.createElement("video");
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private stream?: MediaStream;
  private source?: MediaStreamTrack;
  private frameCallback?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private cancelPending?: () => void;
  private stopped = false;
  private version = 0;
  private readonly sourceEnded = () => {
    this.fail(new XmaxError(XmaxErrorCode.mediaError, "Camera source ended during rotation"));
  };

  constructor(private readonly options: {
    width: number;
    height: number;
    frameRate: number;
    rotation: Exclude<CameraRotation, 0>;
    onError: (error: XmaxError) => void;
  }) {
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context || typeof this.canvas.captureStream !== "function") {
      throw new XmaxError(XmaxErrorCode.mediaError, "Canvas camera rotation is not supported by this browser");
    }
    this.context = context;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;
  }

  /** 等待第一帧实际绘制成功；换摄像头时复用输出轨，不重建 sender。 */
  async setSource(source: MediaStreamTrack): Promise<MediaStreamTrack> {
    if (this.stopped) throw new XmaxError(XmaxErrorCode.cancelled, "Camera rotation has stopped");
    if (source.readyState === "ended") {
      this.stop();
      throw new XmaxError(XmaxErrorCode.mediaError, "Camera rotation requires a live source");
    }
    this.cancelPending?.();
    this.cancelFrame();
    this.source?.removeEventListener("ended", this.sourceEnded);
    const version = ++this.version;
    this.source = source;
    source.addEventListener("ended", this.sourceEnded);
    this.video.srcObject = new MediaStream([source]);

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.cancelPending = undefined;
          if (error) reject(error);
          else resolve();
        };
        const timeout = setTimeout(() => finish(new XmaxError(XmaxErrorCode.timeout, "Timed out waiting for a camera rotation frame")), 10000);
        this.cancelPending = () => finish(new XmaxError(XmaxErrorCode.cancelled, "Camera rotation source changed"));
        // play() 的异步完成也可能晚于停止/切换，不能复活旧的绘制循环。
        void this.video.play().then(() => {
          if (settled || this.stopped || version !== this.version) return;
          const firstFrame = () => {
            if (settled || this.stopped || version !== this.version) return;
            try {
              if (!this.draw()) { this.schedule(firstFrame); return; }
              this.stream ??= this.canvas.captureStream(this.options.frameRate);
              if (!this.stream.getVideoTracks()[0]) throw new Error("Canvas did not produce a video track");
              this.requestFrame();
              finish();
              this.schedule(() => this.render(version));
            } catch (error) { finish(error); }
          };
          this.schedule(firstFrame);
        }, finish);
      });
      if (this.stopped || version !== this.version) {
        throw new XmaxError(XmaxErrorCode.cancelled, "Camera rotation source changed");
      }
      return this.stream!.getVideoTracks()[0]!;
    } catch (error) {
      if (version === this.version) this.stop();
      throw XmaxError.from(error);
    }
  }

  /** 换设备前解除旧原始轨监听，保留 Canvas 最后一帧及输出轨。 */
  pauseSource(): void {
    ++this.version;
    this.cancelPending?.();
    this.cancelFrame();
    this.source?.removeEventListener("ended", this.sourceEnded);
    this.source = undefined;
    this.video.pause();
    this.video.srcObject = null;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    ++this.version;
    this.cancelPending?.();
    this.cancelFrame();
    this.source?.removeEventListener("ended", this.sourceEnded);
    this.source = undefined;
    this.video.pause();
    this.video.srcObject = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.canvas.width = this.canvas.height = 0;
  }

  private draw(): boolean {
    const { videoWidth: width, videoHeight: height } = this.video;
    if (this.video.readyState < 2 || !width || !height) return false;
    const { width: outWidth, height: outHeight, rotation } = this.options;
    const quarterTurn = rotation === 90 || rotation === 270;
    const targetWidth = quarterTurn ? outHeight : outWidth;
    const targetHeight = quarterTurn ? outWidth : outHeight;
    // 设备不一定满足请求宽高；按真实帧尺寸等比居中裁剪，绝不拉伸。
    const scale = Math.max(targetWidth / width, targetHeight / height);
    const cropWidth = targetWidth / scale, cropHeight = targetHeight / scale;
    this.context.setTransform(1, 0, 0, 1, outWidth / 2, outHeight / 2);
    this.context.rotate(rotation * Math.PI / 180);
    this.context.drawImage(this.video, (width - cropWidth) / 2, (height - cropHeight) / 2,
      cropWidth, cropHeight, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
    return true;
  }

  private render(version: number): void {
    if (this.stopped || version !== this.version) return;
    try {
      if (this.draw()) this.requestFrame();
      this.schedule(() => this.render(version));
    } catch (error) { this.fail(XmaxError.from(error)); }
  }

  private requestFrame(): void {
    const track = this.stream?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    track?.requestFrame?.();
  }

  private schedule(callback: () => void): void {
    if (typeof this.video.requestVideoFrameCallback === "function") {
      this.frameCallback = this.video.requestVideoFrameCallback(callback);
    } else {
      this.timer = setTimeout(callback, 1000 / this.options.frameRate);
    }
  }

  private cancelFrame(): void {
    if (this.frameCallback !== undefined) this.video.cancelVideoFrameCallback(this.frameCallback);
    clearTimeout(this.timer);
    this.frameCallback = undefined;
    this.timer = undefined;
  }

  private fail(error: XmaxError): void {
    this.stop();
    this.options.onError(error);
  }
}
