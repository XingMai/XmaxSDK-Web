import type { CameraControlling, CameraPreviewReadyHandler } from "./Camera/CameraControlling";
import type { LocalVideoController } from "./Video/LocalVideoController";
import type { NetworkVideoController } from "./Video/NetworkVideoController";
import type { ExternalVideoController } from "./Video/ExternalVideoController";
import type { InteractionControlling } from "./Interaction/InteractionControlling";
import type { RealtimeVideoTrack } from "../Service/Realtime/RealtimeVideoTrack";
import type { RealtimeMediaStream } from "../Service/Realtime/RealtimeMediaStream";
import type { RealtimeReferenceVideo } from "../Service/Realtime/RealtimeReferenceVideo";

/**
 * 媒体层统一入口，不向 Core 暴露内部媒体控制器。
 */
export interface MediaControlling extends InteractionControlling {
  /**
   * 活动源及可发布轨道；网络视频没有本地上行轨。
   */
  readonly currentTrack?: RealtimeVideoTrack;
  readonly uplinkTrack?: RealtimeVideoTrack;
  readonly source?: "camera" | "localVideo" | "networkVideo" | "externalVideo";
  readonly hasAudio: boolean;
  readonly isFrameValidationEnabled: boolean;
  readonly referenceVideo?: RealtimeReferenceVideo;
  readonly onNetworkVideoFinish?: () => void;

  /**
   * 验证没有活动或正在准备的本地媒体。
   */
  ensureNoLocalSource(): void;
  /**
   * 验证 RTC 支持外部媒体输入。
   */
  validateExternalMediaSupport(kind: "local" | "external"): void;
  /**
   * 创建相机采集及预览。
   */
  createLocalCameraStream(options: Parameters<CameraControlling["createLocalCameraStream"]>[0]): Promise<RealtimeMediaStream>;
  /**
   * 创建服务端读取的网络视频源，RTC 初始化由 prepareSource 完成。
   */
  createNetworkVideoStream(options: Parameters<NetworkVideoController["create"]>[0]): RealtimeMediaStream;
  /**
   * 创建文件视频源并解锁播放，RTC 初始化由 prepareSource 完成。
   */
  createLocalVideoStream(options: Parameters<LocalVideoController["create"]>[0], signal: AbortSignal): Promise<RealtimeMediaStream>;
  /**
   * 创建外部轨道副本，RTC 初始化由 prepareSource 完成。
   */
  createExternalVideoStream(options: Parameters<ExternalVideoController["create"]>[0]): RealtimeMediaStream;
  /**
   * 初始化当前非相机源的 RTC 并安装外部轨道，每个异步边界检查操作有效性。
   */
  prepareSource(ensureCurrent: () => void): Promise<void>;
  /**
   * 设置相机预览就绪通知。
   */
  setCameraPreviewReadyHandler(handler?: CameraPreviewReadyHandler): void;
  /**
   * 等待相机预热，可随连接取消。
   */
  waitForValidCameraFrame(signal: AbortSignal): Promise<void>;
  /**
   * 切换相机，外部轨道由调用方管理。
   */
  switchCamera(): Promise<RealtimeMediaStream>;
  /**
   * 停止相机并释放其资源。
   */
  stopLocalCameraStream(): Promise<void>;
  /**
   * 生成开始后启动文件视频播放。
   */
  startLocalVideo(signal: AbortSignal): Promise<void>;
  /**
   * 暂停文件视频，保留本地资源。
   */
  pauseLocalVideo(): void;
  /**
   * 释放当前源和 RTC，任何失败都不跳过本地轨道清理。
   */
  stopLocalStream(): Promise<void>;
}
