import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { MediaService } from "../../Service/Media/MediaService";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import { VideoRenderRegistry, type VideoRenderTarget } from "../../Service/Realtime/VideoRenderBinding";
import { resolveLocalMediaVideoFormat } from "../LocalMediaVideoFormat";

/**
 * 图片解码、静止画面输出及预览资源。
 */
interface LocalImageSource {
  image: HTMLImageElement;
  canvas: HTMLCanvasElement;
  url: string;
  abort: AbortController;
  targets: Set<VideoRenderTarget>;
  stream?: MediaStream;
  track?: RealtimeVideoTrack;
  timer?: ReturnType<typeof setInterval>;
  onEnded?: () => void;
}

/**
 * 将本地图片等比缩放为静止视频流，不上传文件、不采集设备、不生成音频。
 */
export class LocalImageController {
  /**
   * 当前图片源，包含尚未完成的解码操作。
   */
  private source?: LocalImageSource;

  /**
   * 注入运行期错误通知，不创建浏览器资源。
   */
  constructor(private readonly onError: (error: XmaxError) => void) {}

  /**
   * 是否持有正在准备或可用的图片源。
   */
  get isActive(): boolean {
    return this.source !== undefined;
  }

  /**
   * 已准备的本地图片视频轨。
   */
  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.source?.track;
  }

  /**
   * 解码图片、准备静止画面并持续输出帧；取消或失败时释放本次资源。
   */
  async create(options: {
    file: Blob;
    videoFormat: RealtimeVideoFormat;
  }, mediaService: MediaService, signal: AbortSignal): Promise<RealtimeMediaStream> {
    if (this.source) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Close the current local image before creating another one");
    }
    if (!(options.file instanceof Blob) || options.file.size === 0) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Local image requires a non-empty File or Blob");
    }
    const format = resolveLocalMediaVideoFormat(options.videoFormat, mediaService);
    if (signal.aborted) {
      throw this.cancelled();
    }
    if (typeof document === "undefined") {
      throw new XmaxError(XmaxErrorCode.mediaError, "Local image requires a browser");
    }

    const image = document.createElement("img");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.captureStream !== "function") {
      throw new XmaxError(XmaxErrorCode.mediaError, "Canvas video capture is unavailable");
    }
    canvas.width = format.width;
    canvas.height = format.height;
    const source: LocalImageSource = {
      image, canvas, url: URL.createObjectURL(options.file),
      abort: new AbortController(), targets: new Set(),
    };
    this.source = source;

    try {
      await this.load(source, signal);
      if (signal.aborted || this.source !== source) {
        throw this.cancelled();
      }
      if (!image.naturalWidth || !image.naturalHeight) {
        throw new XmaxError(XmaxErrorCode.mediaError, "The image has no valid dimensions");
      }

      // 仅在解码完成时绘制一次图片；后续发送同一快照，动图也不会继续播放。
      const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.fillStyle = "black";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      source.stream = canvas.captureStream(format.fps);
      const nativeTrack = source.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
      if (!nativeTrack || nativeTrack.readyState !== "live") {
        throw new XmaxError(XmaxErrorCode.mediaError, "Canvas did not provide a live video track");
      }
      const track = new RealtimeVideoTrack({ id: "local-image", videoFormat: format });
      track.mediaStreamTrack = nativeTrack;
      source.track = track;

      const refresh = () => {
        // 重绘快照使 Canvas 产生新帧；不重复绘制原图，避免动图内容变化。
        context.drawImage(canvas, 0, 0);
        if (typeof nativeTrack.requestFrame === "function") {
          nativeTrack.requestFrame();
        }
      };
      refresh();
      source.timer = setInterval(() => {
        if (this.source !== source) {
          return;
        }
        try {
          refresh();
        } catch {
          this.handleError(source);
        }
      }, 1000 / format.fps);
      source.onEnded = () => this.handleError(source);
      nativeTrack.addEventListener("ended", source.onEnded);

      VideoRenderRegistry.register(track, {
        attachHandler: view => {
          if (this.source !== source) {
            return;
          }
          view.isMirrored = false;
          view.setMediaStream(source.stream!);
          source.targets.add(view);
        },
        detachHandler: view => {
          source.targets.delete(view);
          view.setMediaStream(null);
        },
      });
      return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
    } catch (error) {
      if (this.source === source) {
        this.stop();
      }
      throw XmaxError.from(error);
    }
  }

  /**
   * 取消解码、清空预览并释放视频轨、定时器和对象 URL。
   */
  stop(): void {
    const source = this.source;
    this.source = undefined;
    if (!source) {
      return;
    }

    source.abort.abort();
    clearInterval(source.timer);
    if (source.track) {
      VideoRenderRegistry.unregister(source.track);
      if (source.onEnded) {
        source.track.mediaStreamTrack?.removeEventListener("ended", source.onEnded);
      }
      source.track.mediaStreamTrack = undefined;
    }
    for (const view of source.targets) {
      try {
        view.setMediaStream(null);
      } catch {
        // 单个视图异常不能阻断媒体资源清理。
      }
    }
    source.targets.clear();
    source.stream?.getTracks().forEach(track => track.stop());
    source.image.removeAttribute("src");
    URL.revokeObjectURL(source.url);
    source.canvas.width = 0;
    source.canvas.height = 0;
  }

  /**
   * 等待浏览器完成图片解码，支持主动停止、操作取消和超时。
   */
  private load(source: LocalImageSource, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: XmaxError) => {
        clearTimeout(timer);
        source.image.removeEventListener("load", loaded);
        source.image.removeEventListener("error", failed);
        signal.removeEventListener("abort", aborted);
        source.abort.signal.removeEventListener("abort", aborted);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const loaded = () => finish();
      const failed = () => finish(new XmaxError(XmaxErrorCode.mediaError, "The browser cannot decode this image file"));
      const aborted = () => finish(this.cancelled());
      const timer = setTimeout(() => finish(new XmaxError(XmaxErrorCode.timeout, "Local image preparation timed out")), 10_000);
      source.image.addEventListener("load", loaded, { once: true });
      source.image.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", aborted, { once: true });
      source.abort.signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted || source.abort.signal.aborted) {
        aborted();
      } else {
        source.image.src = source.url;
      }
    });
  }

  /**
   * 输出失效时停止刷新并仅报告一次，资源由业务生命周期统一释放。
   */
  private handleError(source: LocalImageSource): void {
    if (this.source !== source || source.timer === undefined) {
      return;
    }
    clearInterval(source.timer);
    source.timer = undefined;
    this.onError(new XmaxError(XmaxErrorCode.mediaError, "Local image video output failed"));
  }

  /**
   * 构造统一的图片操作取消错误。
   */
  private cancelled(): XmaxError {
    return new XmaxError(XmaxErrorCode.cancelled, "Local image operation was cancelled");
  }
}
