import type { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import type { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";

/**
 * 通知摄像头预览就绪，并提供异步处理时检查该预览仍有效的能力。
 */
export type CameraPreviewReadyHandler = (isCurrent: () => boolean) => void;

/**
 * 定义本地摄像头流、麦克风采集和预览资源管理能力。
 */
export interface CameraControlling {
  /** 当前本地相机视频轨道；尚未创建或已停止时为空。 */
  readonly currentTrack?: RealtimeVideoTrack;

  /** 当前相机流是否配置为使用麦克风。 */
  readonly useMicrophone: boolean;

  /** 发布前等待当前相机曝光稳定；超时或取消时拒绝。 */
  waitUntilExposureReady(signal: AbortSignal): Promise<void>;

  /** 设置当前相机流的一次性内部就绪处理；条件为已收到有效帧且预览已绑定。 */
  setPreviewReadyHandler(handler?: CameraPreviewReadyHandler): void;

  /**
   * 创建并启动本地相机流。
   * @throws 已有活动相机流、格式无效、权限不足或采集启动失败时抛出错误。
   */
  createLocalCameraStream(options: {
    videoFormat: RealtimeVideoFormat;
    position: CameraPosition;
    useMicrophone: boolean;
  }): Promise<RealtimeMediaStream>;

  /** 停止相机和麦克风采集，并释放当前轨道及本地预览资源。 */
  stopLocalCameraStream(): Promise<void>;

  /**
   * 在前置和后置摄像头之间切换，保留当前视频轨道。
   * @throws 相机流尚未启动或设备切换失败时抛出错误。
   */
  switchCamera(): Promise<RealtimeMediaStream>;
}
