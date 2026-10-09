import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { MediaService } from "../../Service/Media/MediaService";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import { RealtimeVideoSampleMethod, type RealtimeReferenceVideo } from "../../Service/Realtime/RealtimeReferenceVideo";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import { VideoRenderRegistry, type VideoRenderTarget } from "../../Service/Realtime/VideoRenderBinding";

/**
 * 管理服务端读取的网络视频源和独立静音预览，不创建上行媒体轨道。
 */
export class NetworkVideoController {
  /**
   * 当前视频源与完成通知
   */
  currentTrack?: RealtimeVideoTrack;
  reference?: RealtimeReferenceVideo;
  onFinish?: () => void;

  /**
   * 预览进度与视图资源
   */
  private position = 0;
  private ended = false;
  private readonly bindings = new Map<VideoRenderTarget, () => void>();

  /**
   * 创建网络视频源，校验地址、采样方式和模型支持的尺寸；不请求视频下载。
   */
  create(options: {
    url: string;
    videoFormat: RealtimeVideoFormat;
    sampleMethod?: RealtimeVideoSampleMethod;
    onFinish?: () => void;
  }, mediaService: MediaService): RealtimeMediaStream {
    let url: URL;
    try {
      url = new URL(options.url);
    } catch {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Network video requires an absolute HTTP or HTTPS URL");
    }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Network video requires an HTTP or HTTPS URL without embedded credentials");
    }
    const sampleMethod = options.sampleMethod ?? RealtimeVideoSampleMethod.time;
    if (!Object.values(RealtimeVideoSampleMethod).includes(sampleMethod)) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Unsupported video sample method");
    }
    if (this.currentTrack) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Close the current network video stream before creating another one");
    }

    options.videoFormat.validate();
    const size = mediaService.resolveModelInputSize(options.videoFormat);
    const track = new RealtimeVideoTrack({
      id: "network-video",
      videoFormat: options.videoFormat.resized(size.width, size.height),
    });
    this.currentTrack = track;
    this.reference = Object.freeze({ path: options.url.trim(), sampleMethod });
    this.onFinish = options.onFinish;

    VideoRenderRegistry.register(track, {
      attachHandler: (view) => this.attach(view),
      detachHandler: (view) => this.detach(view),
    });
    return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
  }

  /**
   * 释放全部预览绑定及源信息，不影响其他媒体源。
   */
  stop(): void {
    for (const view of this.bindings.keys()) {
      this.detach(view);
    }
    if (this.currentTrack) {
      VideoRenderRegistry.unregister(this.currentTrack);
    }
    this.currentTrack = undefined;
    this.reference = undefined;
    this.onFinish = undefined;
    this.position = 0;
    this.ended = false;
  }

  /**
   * 绑定播放器，恢复预览位置；本地播放错误仅记录，不中断服务端生成。
   */
  private attach(view: VideoRenderTarget): void {
    if (!this.reference || !view.videoElement || !view.setVideoURL) {
      throw new XmaxError(XmaxErrorCode.mediaError, "This render target does not support network video preview");
    }
    this.detach(view);
    const video = view.videoElement;
    video.autoplay = !this.ended;
    const restore = () => {
      if (this.position > 0) {
        video.currentTime = Math.min(this.position, Math.max(0, video.duration - 0.001) || this.position);
      }
      if (this.ended) {
        video.pause();
      }
    };
    const fail = () => {
      XmaxLogger.render.warning(() => "网络视频预览失败 (Network Video Preview Failed)");
    };
    video.addEventListener("loadedmetadata", restore);
    video.addEventListener("error", fail);
    this.bindings.set(view, () => {
      this.position = video.currentTime;
      this.ended = video.ended || this.ended;
      video.removeEventListener("loadedmetadata", restore);
      video.removeEventListener("error", fail);
      view.setVideoURL?.(null);
    });
    view.isMirrored = false;
    view.setVideoURL(this.reference.path);
  }

  /**
   * 保存预览进度并释放该视图的地址和事件监听。
   */
  private detach(view: VideoRenderTarget): void {
    this.bindings.get(view)?.();
    this.bindings.delete(view);
  }
}
