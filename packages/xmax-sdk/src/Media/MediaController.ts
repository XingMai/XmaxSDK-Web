import { XmaxError, XmaxErrorCode } from "../Foundation/Errors/XmaxError";
import type { RtcManaging } from "../Foundation/RTC/RtcManaging";
import type { MediaService } from "../Service/Media/MediaService";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import { CameraController } from "./Camera/CameraController";
import type { CameraControlling, CameraPreviewReadyHandler } from "./Camera/CameraControlling";
import { LocalVideoController } from "./Video/LocalVideoController";
import { NetworkVideoController } from "./Video/NetworkVideoController";
import { ExternalVideoController } from "./Video/ExternalVideoController";
import { LocalImageController } from "./Image/LocalImageController";
import { InteractionController } from "./Interaction/InteractionController";
import type { InteractionListener } from "./Interaction/InteractionControlling";
import type { InteractionFrame } from "./Interaction/InteractionFrame";
import type { MediaControlling } from "./MediaControlling";

/**
 * 统一持有本地媒体及交互组件；Core 负责串行业务操作，本层管理源和 RTC 资源。
 */
export class MediaController implements MediaControlling {
  /**
   * 本地媒体与交互组件
   */
  private readonly camera: CameraControlling;
  private readonly video: LocalVideoController;
  private readonly image: LocalImageController;
  private readonly network = new NetworkVideoController();
  private readonly external: ExternalVideoController;
  private readonly interaction: InteractionController;

  /**
   * 注入基础能力与错误、交互输出，不自行创建跨层业务组件。
   */
  constructor(private readonly dependencies: {
    rtcManager: RtcManaging;
    mediaService: MediaService;
    cameraController?: CameraControlling;
    onCameraError: (error: XmaxError) => void;
    onVideoError: (error: XmaxError) => void;
    onExternalError: (error: XmaxError) => void;
    onImageError: (error: XmaxError) => void;
    interactionListener: InteractionListener;
  }) {
    this.camera = dependencies.cameraController ?? new CameraController({
      rtcManager: dependencies.rtcManager,
      mediaService: dependencies.mediaService,
      errorListener: dependencies.onCameraError,
    });
    this.video = new LocalVideoController(dependencies.onVideoError);
    this.image = new LocalImageController(dependencies.onImageError);
    this.external = new ExternalVideoController(dependencies.onExternalError);
    this.interaction = new InteractionController(dependencies.interactionListener);
  }

  /**
   * 当前可发布的轨道。
   */
  get uplinkTrack() {
    return this.external.currentTrack ?? this.video.currentTrack ?? this.image.currentTrack ?? this.camera.currentTrack;
  }

  /**
   * 当前本地源轨道，包含无上行的网络视频。
   */
  get currentTrack() {
    return this.uplinkTrack ?? this.network.currentTrack;
  }

  /**
   * 从实际资源推导来源，不维护另一份媒体状态。
   */
  get source(): MediaControlling["source"] {
    if (this.external.currentTrack) {
      return "externalVideo";
    }
    if (this.video.isActive) {
      return "localVideo";
    }
    if (this.image.isActive) {
      return "localImage";
    }
    if (this.network.currentTrack) {
      return "networkVideo";
    }
    if (this.camera.currentTrack) {
      return "camera";
    }

    return undefined;
  }

  /**
   * 当前源需要发布的音频能力。
   */
  get hasAudio() {
    return this.video.isActive ? !!this.video.audioTrack : this.source === "camera" && this.camera.useMicrophone;
  }

  /**
   * 非相机源不等待相机预热。
   */
  get isFrameValidationEnabled() {
    return this.source === "camera" && this.camera.isFrameValidationEnabled;
  }

  /**
   * 网络视频的服务端读取参数。
   */
  get referenceVideo() {
    return this.network.reference;
  }

  /**
   * 网络视频完成回调。
   */
  get onNetworkVideoFinish() {
    return this.network.onFinish;
  }

  /**
   * 创建前拒绝覆盖活动源或尚未完成的文件准备。
   */
  ensureNoLocalSource(): void {
    if (this.currentTrack || this.video.isActive || this.image.isActive) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Close the current local stream before creating another one");
    }
  }

  /**
   * 保持现有外部轨道能力校验与错误语义。
   */
  validateExternalMediaSupport(kind: "local" | "external" | "image"): void {
    if (!this.dependencies.rtcManager.setExternalMediaTracks) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, `The RTC provider does not support ${kind} video streams`);
    }
  }

  /**
   * 创建相机流，由相机组件管理 RTC 和预览。
   */
  createLocalCameraStream(options: Parameters<MediaControlling["createLocalCameraStream"]>[0]) {
    this.ensureNoLocalSource();
    return this.camera.createLocalCameraStream(options);
  }
  /**
   * 同步准备网络视频源；地址校验失败不初始化 RTC。
   */
  createNetworkVideoStream(options: Parameters<MediaControlling["createNetworkVideoStream"]>[0]) {
    this.ensureNoLocalSource();
    return this.network.create(options, this.dependencies.mediaService);
  }
  /**
   * 先解锁用户触发的播放，再由 prepareSource 初始化 RTC。
   */
  createLocalVideoStream(options: Parameters<MediaControlling["createLocalVideoStream"]>[0], signal: AbortSignal) {
    this.ensureNoLocalSource();
    return this.video.create(options, this.dependencies.mediaService, signal);
  }

  /**
   * 解码本地图片并准备静止视频轨，不申请设备权限。
   */
  createLocalImageStream(options: Parameters<MediaControlling["createLocalImageStream"]>[0], signal: AbortSignal) {
    this.ensureNoLocalSource();
    return this.image.create(options, this.dependencies.mediaService, signal);
  }

  /**
   * 接管外部视频轨副本，不停止调用方原始轨道。
   */
  createExternalVideoStream(options: Parameters<MediaControlling["createExternalVideoStream"]>[0]) {
    this.ensureNoLocalSource();
    return this.external.create(options, this.dependencies.mediaService);
  }
  /**
   * 初始化 RTC 并绑定非相机轨道；取消后不继续安装轨道。
   */
  async prepareSource(ensureCurrent: () => void): Promise<void> {
    const rtc = this.dependencies.rtcManager;
    await rtc.initialize();
    ensureCurrent();

    const track = this.external.currentTrack ?? this.video.currentTrack ?? this.image.currentTrack;
    if (track?.mediaStreamTrack) {
      await rtc.setExternalMediaTracks!({ videoTrack: track.mediaStreamTrack, audioTrack: this.video.audioTrack });
      ensureCurrent();
    }
  }
  /**
   * 设置相机预览就绪通知。
   */
  setCameraPreviewReadyHandler(handler?: CameraPreviewReadyHandler): void {
    this.camera.setPreviewReadyHandler(handler);
  }

  /**
   * 等待相机预热。
   */
  waitForValidCameraFrame(signal: AbortSignal): Promise<void> {
    return this.camera.waitForValidCameraFrame(signal);
  }

  /**
   * 切换相机；外部采集不由 SDK 控制。
   */
  switchCamera() {
    if (this.external.currentTrack) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "External video capture is managed by the caller");
    }
    return this.camera.switchCamera();
  }
  /**
   * 停止相机资源。
   */
  stopLocalCameraStream(): Promise<void> {
    return this.camera.stopLocalCameraStream();
  }

  /**
   * 生成开始后启动文件播放。
   */
  startLocalVideo(signal: AbortSignal): Promise<void> {
    return this.video.start(signal);
  }

  /**
   * 断开时保留文件预览资源但暂停时间线。
   */
  pauseLocalVideo(): void {
    this.video.pause();
  }

  /**
   * 释放当前源，RTC 销毁失败也释放外部轨和解码器。
   */
  async stopLocalStream(): Promise<void> {
    this.stopInteraction();
    const external = this.source !== undefined && this.source !== "camera";
    this.network.stop();

    try {
      if (external) {
        await this.dependencies.rtcManager.destroy();
      } else {
        await this.camera.stopLocalCameraStream();
      }
    } finally {
      this.external.stop();
      if (this.image.isActive) {
        this.image.stop();
      }
      if (this.video.isActive) {
        await this.video.stop();
      }
    }
  }
  /**
   * 使用生成格式启用交互，不读取弱网调档后的上行规格。
   */
  startInteraction(taskID: string, format: RealtimeVideoFormat): void {
    this.interaction.startInteraction(taskID, format);
  }

  /**
   * 结束任务时立即清除待发采样。
   */
  stopInteraction(): void {
    this.interaction.stopInteraction();
  }

  /**
   * 接收渲染层快照并交给坐标与发送队列处理。
   */
  submitInteraction(frame: InteractionFrame): void {
    this.interaction.submitInteraction(frame);
  }
}
