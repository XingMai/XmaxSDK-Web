import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import type { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import type { XmaxVideoView } from "./XmaxVideoView";

/**
 * 轨道与渲染视图之间的绑定行为。
 */
export interface VideoRenderBinding {
  /** 视图绑定轨道时调用；负责把画面接入视图。 */
  attachHandler: (view: XmaxVideoView, contentMode: VideoContentMode) => void;

  /** 视图解绑轨道时调用；负责释放画面资源。 */
  detachHandler: (view: XmaxVideoView) => void;
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
