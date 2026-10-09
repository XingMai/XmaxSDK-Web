import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { MediaService } from "../../Service/Media/MediaService";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import { VideoRenderRegistry, type VideoRenderTarget } from "../../Service/Realtime/VideoRenderBinding";

/**
 * 单个文件播放器及其音视频输出资源。
 */
interface LocalVideoSource {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  url: string;
  abort: AbortController;
  targets: Set<VideoRenderTarget>;
  track?: RealtimeVideoTrack;
  stream?: MediaStream;
  audioContext?: AudioContext;
  audioSource?: MediaElementAudioSourceNode;
  audioDestination?: MediaStreamAudioDestinationNode;
  drawTimer?: ReturnType<typeof setInterval>;
  onError?: () => void;
}

/**
 * 将本地文件解码为 Canvas 视频轨和 Web Audio 音频轨，不负责 RTC 发布。
 * 同一个播放器驱动音视频，预览始终静音；准备后停在首帧，生成时按配置播放。
 */
export class LocalVideoController {
  /**
   * 当前文件资源与运行期错误通知
   */
  private source?: LocalVideoSource;
  private readonly onError: (error: XmaxError) => void;

  /**
   * 保存媒体错误处理器，不创建浏览器资源。
   */
  constructor(onError: (error: XmaxError) => void = () => {}) {
    this.onError = onError;
  }

  /**
   * 是否持有文件资源，包含尚未完成准备的播放器。
   */
  get isActive(): boolean {
    return this.source !== undefined;
  }

  /**
   * 准备完成的本地视频轨。
   */
  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.source?.track;
  }

  /**
   * 文件音频输出；禁用音频时为空，无音轨文件的 Web Audio 输出为静音。
   */
  get audioTrack(): MediaStreamTrack | undefined {
    return this.source?.audioDestination?.stream.getAudioTracks()[0];
  }

  /**
   * 校验文件和格式，准备首帧与音频输出；应从用户点击事件直接调用以解锁播放。
   */
  async create(options: {
    file: Blob;
    videoFormat: RealtimeVideoFormat;
    loop?: boolean;
    includeAudio?: boolean;
  }, mediaService: MediaService, signal: AbortSignal): Promise<RealtimeMediaStream> {
    if (this.source) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Close the current local video before creating another one");
    }
    if (!(options.file instanceof Blob) || options.file.size === 0) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Local video requires a non-empty File or Blob");
    }
    options.videoFormat.validate();
    const size = mediaService.resolveModelInputSize(options.videoFormat);
    const format = options.videoFormat.resized(size.width, size.height);
    if (signal.aborted) {
      throw this.cancelled();
    }
    if (typeof document === "undefined") {
      throw new XmaxError(XmaxErrorCode.mediaError, "Local video requires a browser");
    }

    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.captureStream !== "function") {
      throw new XmaxError(XmaxErrorCode.mediaError, "Canvas video capture is unavailable");
    }
    canvas.width = format.width;
    canvas.height = format.height;
    const source: LocalVideoSource = {
      video, canvas, context, url: URL.createObjectURL(options.file),
      abort: new AbortController(), targets: new Set(),
    };
    this.source = source;

    try {
      video.playsInline = true;
      video.loop = options.loop ?? true;
      video.preload = "auto";
      video.volume = 1;
      video.muted = options.includeAudio === false;
      if (options.includeAudio !== false) {
        if (typeof AudioContext === "undefined") {
          throw new XmaxError(XmaxErrorCode.mediaError, "Web Audio is unavailable; disable file audio or use a supported browser");
        }
        const audio = new AudioContext();
        source.audioContext = audio;
        source.audioSource = audio.createMediaElementSource(video);
        source.audioDestination = audio.createMediaStreamDestination();
        source.audioSource.connect(source.audioDestination);
        // 不连接扬声器节点；静音预览不会改变送往 RTC 的原始音频。
      }
      video.src = source.url;

      // 在调用方点击的同一轮事件内解锁播放器和音频上下文，然后回到首帧等待生成。
      const resume = source.audioContext?.resume();
      const playing = this.play(source, signal);
      await this.wait(source, Promise.all([resume, playing]), signal);
      video.pause();
      if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) {
        throw new XmaxError(XmaxErrorCode.mediaError, "The file has no playable finite video stream");
      }
      await this.rewind(source, signal);

      this.draw(source);
      source.stream = canvas.captureStream(format.fps);
      const nativeTrack = source.stream.getVideoTracks()[0];
      if (!nativeTrack) {
        throw new XmaxError(XmaxErrorCode.mediaError, "Canvas did not provide a video track");
      }
      const track = new RealtimeVideoTrack({ id: "local-video", videoFormat: format });
      track.mediaStreamTrack = nativeTrack;
      source.track = track;
      this.draw(source);
      // 暂停和播放结束后继续输出静止画面，避免发布后必须等待文件播放才能协商视频。
      source.drawTimer = setInterval(() => {
        if (this.source !== source) {
          return;
        }
        try {
          this.draw(source);
        } catch {
          this.handleError(source);
        }
      }, 1000 / format.fps);
      source.onError = () => this.handleError(source);
      video.addEventListener("error", source.onError);

      VideoRenderRegistry.register(track, {
        attachHandler: (view) => {
          view.isMirrored = false;
          view.setMediaStream(source.stream!);
          source.targets.add(view);
        },
        detachHandler: (view) => {
          source.targets.delete(view);
          view.setMediaStream(null);
        },
      });
      return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
    } catch (error) {
      await this.stop();
      throw XmaxError.from(error);
    }
  }

  /**
   * 开始信令发送成功后，从文件开头同步启动音视频；不等待远端首帧。
   */
  async start(signal: AbortSignal): Promise<void> {
    const source = this.source;
    if (!source?.track) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Local video is not prepared");
    }
    if (signal.aborted) {
      throw this.cancelled();
    }
    try {
      await this.rewind(source, signal);
      await this.wait(source, Promise.all([source.audioContext?.resume(), this.play(source, signal)]), signal);
    } catch (error) {
      source.video.pause();
      throw error;
    }
  }

  /**
   * 暂停文件音视频，保留当前预览；重新开始生成时回到文件开头。
   */
  pause(): void {
    this.source?.video.pause();
  }

  /**
   * 释放播放器、预览、定时器、轨道、音频上下文和对象 URL。
   */
  async stop(): Promise<void> {
    const source = this.source;
    this.source = undefined;
    if (!source) {
      return;
    }
    source.abort.abort();
    clearInterval(source.drawTimer);
    if (source.onError) {
      source.video.removeEventListener("error", source.onError);
    }
    if (source.track) {
      VideoRenderRegistry.unregister(source.track);
      source.track.mediaStreamTrack = undefined;
    }
    for (const view of source.targets) {
      try {
        view.setMediaStream(null);
      } catch {
        // 单个视图解绑失败不阻断其他资源释放。
      }
    }
    source.targets.clear();
    source.video.pause();
    source.video.removeAttribute("src");
    source.video.load();
    source.stream?.getTracks().forEach(track => track.stop());
    source.audioDestination?.stream.getTracks().forEach(track => track.stop());
    source.audioSource?.disconnect();
    source.audioDestination?.disconnect();
    URL.revokeObjectURL(source.url);
    await source.audioContext?.close().catch(() => {});
  }

  /**
   * 播放被浏览器拒绝时给出可操作错误；关闭后的迟到播放立即暂停。
   */
  private play(source: LocalVideoSource, signal: AbortSignal): Promise<void> {
    return source.video.play().then(() => {
      if (this.source !== source || source.abort.signal.aborted || signal.aborted) {
        source.video.pause();
        throw this.cancelled();
      }
    }).catch(error => {
      if (error instanceof XmaxError) {
        throw error;
      }
      throw new XmaxError(XmaxErrorCode.mediaError, "Cannot play local video; call from a user click and use a browser-supported video codec");
    });
  }

  /**
   * 等待 seek 完成，确保重新生成从首帧开始，而非使用旧缓存画面。
   */
  private async rewind(source: LocalVideoSource, signal: AbortSignal): Promise<void> {
    if (source.video.currentTime === 0) {
      return;
    }
    let seeked!: () => void;
    const ready = new Promise<void>(resolve => { seeked = resolve; });
    source.video.addEventListener("seeked", seeked, { once: true });
    try {
      source.video.currentTime = 0;
      await this.wait(source, ready, signal);
    } finally {
      source.video.removeEventListener("seeked", seeked);
    }
  }

  /**
   * 给浏览器准备和播放操作设置 10 秒上限，同时响应关闭、取消和解码错误。
   */
  private wait(source: LocalVideoSource, operation: Promise<unknown>, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        source.abort.signal.removeEventListener("abort", abort);
        source.video.removeEventListener("error", failed);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const abort = () => finish(this.cancelled());
      const failed = () => finish(new XmaxError(XmaxErrorCode.mediaError, "The browser cannot decode this video file"));
      const timer = setTimeout(() => finish(new XmaxError(XmaxErrorCode.timeout, "Local video preparation timed out; start from a user click and check the video codec")), 10_000);
      signal.addEventListener("abort", abort, { once: true });
      source.abort.signal.addEventListener("abort", abort, { once: true });
      source.video.addEventListener("error", failed, { once: true });
      operation.then(() => finish(), finish);
      if (signal.aborted || source.abort.signal.aborted) {
        abort();
      }
    });
  }

  /**
   * 等比缩放并居中补黑边，保留完整画面，不按设备方向转置文件尺寸。
   */
  private draw(source: LocalVideoSource): void {
    const { video, canvas, context } = source;
    if (video.readyState < 2) {
      return;
    }
    const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    context.fillStyle = "black";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }

  /**
   * 解码或绘制失败时停止媒体推进，并报告一次运行期错误。
   */
  private handleError(source: LocalVideoSource): void {
    if (this.source !== source || source.drawTimer === undefined) {
      return;
    }
    clearInterval(source.drawTimer);
    source.drawTimer = undefined;
    source.video.pause();
    XmaxLogger.realtime.warning(() => "本地视频解码失败 (Local Video Decode Failed)");
    this.onError(new XmaxError(XmaxErrorCode.mediaError, "Local video decoding failed"));
  }

  /**
   * 构造统一的媒体操作取消错误。
   */
  private cancelled(): XmaxError {
    return new XmaxError(XmaxErrorCode.cancelled, "Local video operation was cancelled");
  }
}
