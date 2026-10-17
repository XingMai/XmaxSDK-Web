import { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { XmaxVideoView } from "./XmaxVideoView";
import { VideoRenderRegistry } from "../../Service/Realtime/VideoRenderBinding";
import type { TrajectoryEffectRendering } from "../Trajectory/TrajectoryEffectRendering";

const REMOTE_FADE_DURATION_MS = 300;

/**
 * 在本地预览和远端生成画面之间自动切换的视频容器（框架无关）。
 *
 * 设置 SDK 远端轨道后，等待首帧及渲染预热结束再渐入远端画面；
 * 远端轨道置空时立即恢复本地预览。
 */
export class XmaxRealtimeVideoView {
  /**
   * 视图元素
   */
  /**
   * 视图根元素。
   */
  readonly element: HTMLDivElement;

  /**
   * 视频视图
   */
  private readonly localVideoView: XmaxVideoView;
  private readonly remoteVideoView: XmaxVideoView;

  /**
   * 公共配置
   */
  private currentLocalTrack?: RealtimeVideoTrack;
  private currentRemoteTrack?: RealtimeVideoTrack;
  private contentMode: VideoContentMode;

  /**
   * 创建实时视频容器。
   *
   * @param options.localTrack 需要持续预览的本地视频轨道。
   * @param options.remoteTrack 需要覆盖显示的远端生成视频轨道。
   * @param options.videoContentMode 本地与远端视频的内容显示模式，默认 fill。
   */
  constructor(options?: {
    localTrack?: RealtimeVideoTrack;
    remoteTrack?: RealtimeVideoTrack;
    videoContentMode?: VideoContentMode;
    isInteractionEnabled?: boolean;
  }) {
    this.contentMode = options?.videoContentMode ?? VideoContentMode.fill;
    this.currentLocalTrack = options?.localTrack;
    this.currentRemoteTrack = options?.remoteTrack;

    this.element = document.createElement("div");
    this.element.style.position = "relative";
    this.element.style.overflow = "hidden";
    this.element.style.backgroundColor = "black";

    this.localVideoView = new XmaxVideoView({ videoContentMode: this.contentMode, isInteractionEnabled: false });
    this.remoteVideoView = new XmaxVideoView({ videoContentMode: this.contentMode, isInteractionEnabled: options?.isInteractionEnabled });
    for (const view of [this.localVideoView, this.remoteVideoView]) {
      view.element.style.position = "absolute";
      view.element.style.inset = "0";
      this.element.appendChild(view.element);
    }

    this.localVideoView.track = this.currentLocalTrack;
    this.updateRemoteTrack();
  }

  /**
   * 当前显示的本地视频轨道。
   */
  get localTrack(): RealtimeVideoTrack | undefined {
    return this.currentLocalTrack;
  }

  /**
   * 只控制远端视图的轨迹交互，本地预览始终不接管手势。
   */
  get isInteractionEnabled(): boolean { return this.remoteVideoView.isInteractionEnabled; }

  /**
   * 转交远端交互开关。
   */
  set isInteractionEnabled(enabled: boolean) { this.remoteVideoView.isInteractionEnabled = enabled; }

  /**
   * 远端视图的自定义轨迹效果。
   */
  get trajectoryRenderer(): TrajectoryEffectRendering | undefined { return this.remoteVideoView.trajectoryRenderer; }

  /**
   * undefined 恢复默认效果，不改变轨迹发送逻辑。
   */
  set trajectoryRenderer(renderer: TrajectoryEffectRendering | undefined) { this.remoteVideoView.trajectoryRenderer = renderer; }

  /**
   * 替换本地预览轨道；轨道未变化时保留当前绑定。
   */
  set localTrack(track: RealtimeVideoTrack | undefined) {
    if (this.currentLocalTrack === track) {
      return;
    }
    this.currentLocalTrack = track;
    this.localVideoView.track = track;
  }

  /**
   * 当前显示的远端生成视频轨道。
   * SDK 远端轨道等待首帧及预热后渐入；置空时立即恢复本地预览。
   */
  get remoteTrack(): RealtimeVideoTrack | undefined {
    return this.currentRemoteTrack;
  }

  /**
   * 替换远端轨道并重新等待首帧渐入；清空轨道时恢复本地预览。
   */
  set remoteTrack(track: RealtimeVideoTrack | undefined) {
    if (this.currentRemoteTrack === track) {
      return;
    }
    this.currentRemoteTrack = track;
    this.updateRemoteTrack();
  }

  /**
   * 视频内容在容器中的显示模式。
   */
  get videoContentMode(): VideoContentMode {
    return this.contentMode;
  }

  /**
   * 同步调整本地与远端视频在容器中的缩放和裁剪方式。
   */
  set videoContentMode(mode: VideoContentMode) {
    if (this.contentMode === mode) {
      return;
    }
    this.contentMode = mode;
    this.localVideoView.videoContentMode = mode;
    this.remoteVideoView.videoContentMode = mode;
  }

  /**
   * 本地预览是否镜像显示（前置摄像头）。
   */
  get isLocalMirrored(): boolean {
    return this.localVideoView.isMirrored;
  }

  /**
   * 更新本地预览镜像；不修改采集帧或远端画面。
   */
  set isLocalMirrored(mirrored: boolean) {
    this.localVideoView.isMirrored = mirrored;
  }

  /**
   * 挂载到容器元素。
   */
  attach(to: HTMLElement): void {
    to.appendChild(this.element);
    this.localVideoView.attach(this.element);
    this.remoteVideoView.attach(this.element);
  }

  /**
   * 从容器元素移除。
   */
  detach(): void {
    this.localVideoView.detach();
    this.remoteVideoView.detach();
    this.element.remove();
  }

  /**
   * 更新远端轨道绑定；SDK 轨道共用单轨视图的预热，普通轨道等待首帧后渐入。
   */
  private updateRemoteTrack(): void {
    const remoteTrack = this.currentRemoteTrack;

    this.remoteVideoView.frameDisplayHandler = undefined;
    this.remoteVideoView.track = undefined;
    this.remoteVideoView.element.style.transition = "";
    this.remoteVideoView.element.style.opacity = "0";
    this.remoteVideoView.element.style.visibility = "hidden";

    if (!remoteTrack) {
      return;
    }

    // SDK 远端轨道由单轨视图统一预热和渐入，不再叠加容器动画。
    if (VideoRenderRegistry.binding(remoteTrack)?.renderWarmupMs !== undefined) {
      this.remoteVideoView.element.style.visibility = "visible";
      this.remoteVideoView.track = remoteTrack;
      return;
    }

    this.remoteVideoView.frameDisplayHandler = () => {
      if (this.currentRemoteTrack !== remoteTrack) {
        return;
      }
      this.showRemoteVideo();
    };
    this.remoteVideoView.track = remoteTrack;
  }

  /**
   * 远端首帧已提交：渐入远端画面。
   */
  private showRemoteVideo(): void {
    const element = this.remoteVideoView.element;
    if (element.style.visibility === "visible" && element.style.opacity === "1") {
      return;
    }

    element.style.visibility = "visible";
    element.style.transition = `opacity ${REMOTE_FADE_DURATION_MS}ms ease-in-out`;

    // 强制一帧后再过渡，确保渐入生效。
    requestAnimationFrame(() => {
      element.style.opacity = "1";
    });
  }
}
