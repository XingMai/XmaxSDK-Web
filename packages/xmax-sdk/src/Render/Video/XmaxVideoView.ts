import { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { VideoRenderRegistry } from "../../Service/Realtime/VideoRenderBinding";
import { RemoteVideoFramePipeline, type RemoteFrameInterpolationOptions } from "./RemoteVideoFramePipeline";

const OBJECT_FIT: Record<VideoContentMode, "contain" | "cover"> = {
  [VideoContentMode.fit]: "contain",
  [VideoContentMode.fill]: "cover",
};

/**
 * 单轨视频视图（框架无关）。
 *
 * 通过 `attach(to:)` 挂载到任意容器元素；设置 `track` 后自动渲染。
 * 轨道注册了渲染绑定时走绑定管线，否则按 `mediaStreamTrack` 直接渲染。
 */
export class XmaxVideoView {
  /**
   * 视图元素
   */
  /**
   * 视图根元素（div，内含一个 video 元素）。
   */
  readonly element: HTMLDivElement;

  /**
   * @internal 渲染视频帧的元素，供绑定管线使用。
   */
  readonly videoElement: HTMLVideoElement;

  /**
   * 公共配置
   */
  /**
   * 首帧实际提交显示时调用（一次性；换轨后重新武装）。
   */
  frameDisplayHandler?: () => void;

  /**
   * 渲染状态
   */
  private currentTrack?: RealtimeVideoTrack;
  private contentMode: VideoContentMode;
  private mirrored = false;

  /**
   * 首帧显示通知与异步回调版本
   */
  private hasNotifiedFrameDisplay = false;
  private onPlaying?: () => void;
  private videoFrameCallbackID?: number;
  private frameNotificationSequence = 0;
  /**
   * 远端插帧配置与渲染资源
   */
  private interpolationOptions?: RemoteFrameInterpolationOptions;
  private interpolationPipeline?: RemoteVideoFramePipeline;
  private interpolationCanvas?: HTMLCanvasElement;
  /**
   * DOM 挂载状态
   */
  private detached = false;

  /**
   * 创建单轨视频视图。
   *
   * @param options.videoContentMode 视频内容显示模式，默认 fill。
   */
  constructor(options?: { videoContentMode?: VideoContentMode }) {
    this.contentMode = options?.videoContentMode ?? VideoContentMode.fill;

    this.element = document.createElement("div");
    this.element.style.position = "relative";
    this.element.style.overflow = "hidden";
    this.element.style.backgroundColor = "black";

    this.videoElement = document.createElement("video");
    this.videoElement.autoplay = true;
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;

    this.videoElement.style.position = "absolute";
    this.videoElement.style.inset = "0";
    this.videoElement.style.width = "100%";
    this.videoElement.style.height = "100%";

    this.applyContentMode();

    this.element.appendChild(this.videoElement);
  }

  /**
   * 当前显示的视频轨道；切换时自动解绑旧轨道。
   */
  get track(): RealtimeVideoTrack | undefined {
    return this.currentTrack;
  }

  /**
   * 解绑旧轨道后接入新轨道，并为新内容重新启用一次性首帧通知。
   */
  set track(track: RealtimeVideoTrack | undefined) {
    if (this.currentTrack === track) {
      return;
    }
    this.detachCurrentTrack();
    this.currentTrack = track;
    this.hasNotifiedFrameDisplay = false;
    if (track) {
      this.attachTrack(track);
    }
  }

  /**
   * 视频内容在容器中的显示模式。
   */
  get videoContentMode(): VideoContentMode {
    return this.contentMode;
  }

  /**
   * 更新视频及插帧画布的内容缩放方式；相同配置不重复应用。
   */
  set videoContentMode(mode: VideoContentMode) {
    if (this.contentMode === mode) {
      return;
    }
    this.contentMode = mode;
    this.applyContentMode();
  }

  /**
   * 本地预览是否镜像显示（仅影响显示，不影响发布流）。
   */
  get isMirrored(): boolean {
    return this.mirrored;
  }

  /**
   * 更新视图镜像变换，仅改变呈现方式，不改动媒体流。
   */
  set isMirrored(mirrored: boolean) {
    if (this.mirrored === mirrored) {
      return;
    }
    this.mirrored = mirrored;
    this.applyContentMode();
  }

  /**
   * 挂载到容器元素。
   */
  attach(to: HTMLElement): void {
    this.detached = false;
    to.appendChild(this.element);

    // 浏览器可能在移出 DOM 时暂停 MediaStream video；重新挂载要恢复解码回调。
    if (this.videoElement.srcObject && this.videoElement.paused && typeof this.videoElement.play === "function") {
      void this.videoElement.play().catch((error) => {
        XmaxLogger.render.warning(() => `恢复视频播放失败 (Failed to Resume Video Playback)\n└─ ${String(error)}`);
      });
    }

    this.startInterpolation();
    if (this.videoElement.srcObject && !this.hasNotifiedFrameDisplay) {
      this.armFrameDisplayNotification();
    }
  }

  /**
   * 从容器元素移除。
   */
  detach(): void {
    this.detached = true;
    this.stopInterpolation();
    this.cancelFrameDisplayNotification();
    this.element.remove();
  }

  /**
   * 直接设置渲染用的媒体流（绑定管线和直接渲染共用）。 @internal
   */
  setMediaStream(stream: MediaStream | null): void {
    if (this.videoElement.srcObject === stream) {
      return;
    }

    this.stopInterpolation();
    this.cancelFrameDisplayNotification();
    this.hasNotifiedFrameDisplay = false;

    this.videoElement.srcObject = stream;
    if (stream) {
      this.armFrameDisplayNotification();
      this.startInterpolation();
    }
  }

  /**
   * 由远端绑定注入配置；本地预览不走此管线。 @internal
   */
  setFrameInterpolation(options?: RemoteFrameInterpolationOptions): void {
    if (options === this.interpolationOptions) return;
    this.stopInterpolation();
    this.interpolationOptions = options;
    this.startInterpolation();
  }

  /**
   * 视图已挂载且媒体与配置就绪时创建插帧画布和管线，避免重复启动。
   */
  private startInterpolation(): void {
    if (this.detached || this.interpolationPipeline || !this.interpolationOptions || !this.videoElement.srcObject) return;

    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%",
      pointerEvents: "none", visibility: "hidden", backgroundColor: "black",
    });
    this.interpolationCanvas = canvas;
    this.applyContentMode();
    this.element.appendChild(canvas);

    const pipeline = new RemoteVideoFramePipeline(this.videoElement, canvas, this.interpolationOptions);
    this.interpolationPipeline = pipeline;
    pipeline.start();
  }

  /**
   * 停止并释放插帧管线，移除辅助画布，保留原始视频元素。
   */
  private stopInterpolation(): void {
    const pipeline = this.interpolationPipeline;
    this.interpolationPipeline = undefined;
    pipeline?.stop();
    this.interpolationCanvas?.remove();
    this.interpolationCanvas = undefined;
  }

  /**
   * 接入轨道画面：优先走注册的渲染绑定，否则按媒体轨直接渲染。
   */
  private attachTrack(track: RealtimeVideoTrack): void {
    const binding = VideoRenderRegistry.binding(track);
    if (binding) {
      binding.attachHandler(this, this.contentMode);
      return;
    }

    if (track.mediaStreamTrack) {
      this.setMediaStream(new MediaStream([track.mediaStreamTrack]));
      return;
    }

    XmaxLogger.render.warning(
      () => `轨道 ${track.id} 既没有渲染绑定也没有媒体轨，无法显示`,
    );
  }

  /**
   * 解绑当前轨道并清空渲染内容。
   */
  private detachCurrentTrack(): void {
    const track = this.currentTrack;
    if (track) {
      VideoRenderRegistry.binding(track)?.detachHandler(this);
    }
    this.setFrameInterpolation(undefined);
    this.cancelFrameDisplayNotification();
    this.videoElement.srcObject = null;
  }

  /**
   * 首帧提交合成器时通知；旧浏览器回退到 playing 近似判断。
   */
  private armFrameDisplayNotification(): void {
    this.cancelFrameDisplayNotification();

    const sequence = this.frameNotificationSequence;
    const track = this.currentTrack;
    const binding = track ? VideoRenderRegistry.binding(track) : undefined;

    const notify = () => {
      if (sequence !== this.frameNotificationSequence || this.hasNotifiedFrameDisplay) {
        return;
      }
      this.hasNotifiedFrameDisplay = true;
      this.cancelFrameDisplayNotification();
      binding?.frameDisplayHandler?.();
      this.frameDisplayHandler?.();
    };

    if (typeof this.videoElement.requestVideoFrameCallback === "function") {
      this.videoFrameCallbackID = this.videoElement.requestVideoFrameCallback(notify);
      return;
    }

    this.onPlaying = notify;
    this.videoElement.addEventListener("playing", this.onPlaying, {
      once: true,
    });
    if (!this.videoElement.paused && this.videoElement.readyState >= 2) {
      queueMicrotask(notify);
    }
  }

  /**
   * 换流、解绑或卸载时取消观察，防止迟到的首帧归入下一条流。
   */
  private cancelFrameDisplayNotification(): void {
    this.frameNotificationSequence += 1;
    if (this.videoFrameCallbackID !== undefined) {
      this.videoElement.cancelVideoFrameCallback(this.videoFrameCallbackID);
      this.videoFrameCallbackID = undefined;
    }
    if (this.onPlaying) {
      this.videoElement.removeEventListener("playing", this.onPlaying);
      this.onPlaying = undefined;
    }
  }

  /**
   * 应用显示模式与镜像样式。
   */
  private applyContentMode(): void {
    this.videoElement.style.objectFit = OBJECT_FIT[this.contentMode];
    this.videoElement.style.transform = this.mirrored ? "scaleX(-1)" : "";
    if (this.interpolationCanvas) {
      this.interpolationCanvas.style.objectFit = OBJECT_FIT[this.contentMode];
      this.interpolationCanvas.style.transform = this.mirrored ? "scaleX(-1)" : "";
    }
  }
}
