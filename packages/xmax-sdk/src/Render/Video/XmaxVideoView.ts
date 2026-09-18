import { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { VideoRenderRegistry } from "./VideoRenderBinding";

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
  // 视图元素
  /** 视图根元素（div，内含一个 video 元素）。 */
  readonly element: HTMLDivElement;

  /** @internal 渲染视频帧的元素，供绑定管线使用。 */
  readonly videoElement: HTMLVideoElement;

  // 公共配置
  /** 首帧实际提交显示时调用（一次性；换轨后重新武装）。 */
  frameDisplayHandler?: () => void;

  // 渲染状态
  private currentTrack?: RealtimeVideoTrack;
  private contentMode: VideoContentMode;
  private mirrored = false;
  private hasNotifiedFrameDisplay = false;
  private onPlaying?: () => void;

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

  /** 当前显示的视频轨道；切换时自动解绑旧轨道。 */
  get track(): RealtimeVideoTrack | undefined {
    return this.currentTrack;
  }

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

  /** 视频内容在容器中的显示模式。 */
  get videoContentMode(): VideoContentMode {
    return this.contentMode;
  }

  set videoContentMode(mode: VideoContentMode) {
    if (this.contentMode === mode) {
      return;
    }
    this.contentMode = mode;
    this.applyContentMode();
  }

  /** 本地预览是否镜像显示（仅影响显示，不影响发布流）。 */
  get isMirrored(): boolean {
    return this.mirrored;
  }

  set isMirrored(mirrored: boolean) {
    if (this.mirrored === mirrored) {
      return;
    }
    this.mirrored = mirrored;
    this.applyContentMode();
  }

  /** 挂载到容器元素。 */
  attach(to: HTMLElement): void {
    to.appendChild(this.element);
  }

  /** 从容器元素移除。 */
  detach(): void {
    this.element.remove();
  }

  /** 直接设置渲染用的媒体流（绑定管线和直接渲染共用）。 @internal */
  setMediaStream(stream: MediaStream | null): void {
    if (this.videoElement.srcObject === stream) {
      return;
    }
    this.videoElement.srcObject = stream;
    if (stream) {
      this.armFrameDisplayNotification();
    }
  }

  /** 接入轨道画面：优先走注册的渲染绑定，否则按媒体轨直接渲染。 */
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

  /** 解绑当前轨道并清空渲染内容。 */
  private detachCurrentTrack(): void {
    const track = this.currentTrack;
    if (track) {
      VideoRenderRegistry.binding(track)?.detachHandler(this);
    }
    if (this.onPlaying) {
      this.videoElement.removeEventListener("playing", this.onPlaying);
      this.onPlaying = undefined;
    }
    this.videoElement.srcObject = null;
  }

  /** 武装首帧显示通知：video 进入 playing 时触发一次回调。 */
  private armFrameDisplayNotification(): void {
    if (this.onPlaying) {
      this.videoElement.removeEventListener("playing", this.onPlaying);
    }
    this.onPlaying = () => {
      if (this.hasNotifiedFrameDisplay) {
        return;
      }
      this.hasNotifiedFrameDisplay = true;
      this.frameDisplayHandler?.();
    };
    this.videoElement.addEventListener("playing", this.onPlaying, {
      once: true,
    });
  }

  /** 应用显示模式与镜像样式。 */
  private applyContentMode(): void {
    this.videoElement.style.objectFit = OBJECT_FIT[this.contentMode];
    this.videoElement.style.transform = this.mirrored ? "scaleX(-1)" : "";
  }
}
