import type { InteractionFrame } from "../Media/Interaction/InteractionFrame";
import type { RealtimeVideoTrack } from "../Service/Realtime/RealtimeVideoTrack";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import { VideoRenderRegistry, type VideoRenderTarget } from "../Service/Realtime/VideoRenderBinding";
import type { RenderControlling } from "./RenderControlling";
import type { RemoteFrameInterpolationOptions } from "./Video/RemoteVideoFramePipeline";
import { TrajectoryBinding } from "./Trajectory/TrajectoryBinding";
import { TrajectoryRegistry } from "./Trajectory/TrajectoryRegistry";

/**
 * 统一管理远端轨道的画面、插帧配置转交与交互绑定，不管理生成任务。
 */
export class RenderController implements RenderControlling {
  /**
   * 当前轨道与唯一渲染目标
   */
  private track?: RealtimeVideoTrack;
  private target?: VideoRenderTarget;
  private interactionEnabled = false;

  /**
   * 注入显示生命周期通知，不持有 Core 对象。
   */
  constructor(private readonly callbacks: {
    onFrameDisplayed?: () => void;
    onAttached?: () => void;
    onDetached?: () => void;
  } = {}) {}

  /**
   * 注册新轨道并使旧绑定失效；本地轨道不经过该入口。
   */
  registerRemoteTrack(track: RealtimeVideoTrack, listener: (frame: InteractionFrame) => void): void {
    this.resetRemoteTrack();
    this.track = track;
    if (track.videoFormat) {
      TrajectoryRegistry.register(track, new TrajectoryBinding(listener, track.videoFormat));
    }

    VideoRenderRegistry.register(track, {
      frameDisplayHandler: () => {
        if (this.track === track) {
          this.callbacks.onFrameDisplayed?.();
        }
      },
      attachHandler: view => {
        if (this.track !== track) {
          return;
        }
        this.target?.setFrameInterpolation?.(undefined);
        // 生成结果不再次镜像；显示镜像仍可由视图的公开属性设置。
        view.isMirrored = false;
        this.target = view;
        this.callbacks.onAttached?.();
        view.setMediaStream(track.mediaStreamTrack ? new MediaStream([track.mediaStreamTrack]) : null);
      },
      detachHandler: view => {
        if (this.target === view) {
          this.callbacks.onDetached?.();
          this.target = undefined;
        }
        view.setFrameInterpolation?.(undefined);
        view.setMediaStream(null);
      },
    });
  }

  /**
   * 更新媒体画面；暂停显示时同时禁用交互。
   */
  setRemoteMedia(track: MediaStreamTrack | null): void {
    if (this.track) {
      TrajectoryRegistry.binding(this.track)?.update(!!track && this.interactionEnabled);
    }
    this.target?.setMediaStream(track ? new MediaStream([track]) : null);
  }

  /**
   * 转交插帧配置，不重建交互视图。
   */
  setFrameInterpolation(options?: RemoteFrameInterpolationOptions): void {
    this.target?.setFrameInterpolation?.(options);
  }

  /**
   * 更新交互绑定的输入格式和可用性。
   */
  setInteractionEnabled(enabled: boolean, format?: RealtimeVideoFormat): void {
    this.interactionEnabled = enabled;
    if (this.track) {
      TrajectoryRegistry.binding(this.track)?.update(enabled, format);
    }
  }

  /**
   * 先使能力失效再清空画面，迟到首帧和旧手势不能恢复已结束任务。
   */
  resetRemoteTrack(): void {
    const track = this.track;
    this.track = undefined;
    this.interactionEnabled = false;
    if (track) {
      TrajectoryRegistry.unregister(track);
      VideoRenderRegistry.unregister(track);
    }
    this.target?.setFrameInterpolation?.(undefined);
    this.target?.setMediaStream(null);
    this.target = undefined;
  }
}
