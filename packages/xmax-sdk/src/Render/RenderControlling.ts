import type { InteractionFrame } from "../Media/Interaction/InteractionFrame";
import type { RealtimeVideoTrack } from "../Service/Realtime/RealtimeVideoTrack";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import type { RemoteFrameInterpolationOptions } from "./Video/RemoteVideoFramePipeline";

/**
 * 渲染层统一入口；Core 不直接持有视图、Registry 或轨迹 Binding。
 */
export interface RenderControlling {
  /**
   * 当前远端视图是否已完成渲染预热。
   */
  readonly isReady: boolean;

  /**
   * 新任务开始前重置展示就绪状态，已有视图重新等待首帧和预热。
   */
  prepareForGeneration(): void;

  /**
   * 注册远端画面和交互能力；任务开始前交互不可用。
   */
  registerRemoteTrack(track: RealtimeVideoTrack, listener: (frame: InteractionFrame) => void): void;
  /**
   * 同步远端流到当前视图，null 只清空画面，不销毁轨道。
   */
  setRemoteMedia(track: MediaStreamTrack | null): void;
  /**
   * 同步插帧配置；undefined 停用。
   */
  setFrameInterpolation(options?: RemoteFrameInterpolationOptions): void;
  /**
   * 开始或停止任务交互，格式为模型输入尺寸，不是下行尺寸。
   */
  setInteractionEnabled(enabled: boolean, format?: RealtimeVideoFormat): void;
  /**
   * 注销远端能力并清理视图资源，保留本地预览。
   */
  resetRemoteTrack(): void;
}
