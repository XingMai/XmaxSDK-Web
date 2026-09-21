import type { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import type { RealtimeVideoTrack } from "./RealtimeVideoTrack";
import type { RemoteFrameInterpolationOptions } from "../../Render/Video/RemoteVideoFramePipeline";

/**
 * 轨道渲染目标。
 *
 * 由渲染层视图实现；绑定管线只通过该接口向视图送流和调整镜像，
 * 不感知具体视图类型。
 */
export interface VideoRenderTarget {
  /** 画面是否镜像显示（仅影响显示，不影响发布流）。 */
  isMirrored: boolean;

  /** 设置渲染用的媒体流；传 null 清空画面。 */
  setMediaStream: (stream: MediaStream | null) => void;
  /** SDK 视频视图实现；自定义只显示原流的目标可以不实现。 */
  setFrameInterpolation?: (options?: RemoteFrameInterpolationOptions) => void;
}

/**
 * 轨道与渲染视图之间的绑定行为。
 */
export interface VideoRenderBinding {
  /** 视图首帧呈现时通知轨道拥有者，独立于视图自身的渐入回调。 */
  frameDisplayHandler?: () => void;

  /** 视图绑定轨道时调用；负责把画面接入视图。 */
  attachHandler: (target: VideoRenderTarget, contentMode: VideoContentMode) => void;

  /** 视图解绑轨道时调用；负责释放画面资源。 */
  detachHandler: (target: VideoRenderTarget) => void;
}

/**
 * 轨道渲染绑定注册表。
 *
 * 摄像头等需要自定义渲染管线的轨道在创建时注册绑定；
 * 未注册绑定的轨道由视图按 `mediaStreamTrack` 直接渲染。
 */
export class VideoRenderRegistry {
  private static bindings = new WeakMap<RealtimeVideoTrack, VideoRenderBinding>();

  /** @internal */
  static register(track: RealtimeVideoTrack, binding: VideoRenderBinding): void {
    VideoRenderRegistry.bindings.set(track, binding);
  }

  /** @internal */
  static unregister(track: RealtimeVideoTrack): void {
    VideoRenderRegistry.bindings.delete(track);
  }

  /** @internal */
  static binding(forTrack: RealtimeVideoTrack): VideoRenderBinding | undefined {
    return VideoRenderRegistry.bindings.get(forTrack);
  }
}
