import { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import type { CameraCaptureManaging } from "../../Foundation/Media/Camera/CameraCaptureManaging";
import { CameraCaptureManager } from "../../Foundation/Media/Camera/CameraCaptureManager";
import { XmaxError, XmaxErrorCode, type XmaxErrorListener } from "../../Foundation/Errors/XmaxError";
import type { PermissionManaging } from "../../Foundation/Permissions/PermissionManaging";
import { PermissionManager } from "../../Foundation/Permissions/PermissionManager";
import { VideoRenderRegistry } from "../../Render/Video/VideoRenderBinding";
import type { MediaServicing } from "../../Service/Media/MediaServicing";
import { MediaService } from "../../Service/Media/MediaService";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import type { CameraControlling, CameraPreviewReadyHandler } from "./CameraControlling";

/**
 * 协调浏览器摄像头采集和 SDK 本地预览。
 *
 * Web 差异：预览绑定直接把采集 `MediaStream` 挂到视图；麦克风在
 * 实时连接建立时由 RTC 层启动（M2 接入），当前仅维护配置与权限。
 */
export class CameraController implements CameraControlling {
  // 轨道标识
  private static readonly localVideoTrackID = "video0";

  // 基础层组件
  private readonly permissionManager: PermissionManaging;
  private readonly captureManager: CameraCaptureManaging;

  // 服务层组件
  private readonly mediaService: MediaServicing;

  // 事件监听
  private readonly errorListener: XmaxErrorListener;
  private previewReadyHandler?: CameraPreviewReadyHandler;

  // 本地资源
  private activeTrack?: RealtimeVideoTrack;

  // 预览状态
  private hasCapturedFrame = false;
  private isPreviewAttached = false;

  // 麦克风配置
  private storedUseMicrophone = false;

  /**
   * 创建相机控制器。
   *
   * @param options.permissionManager 权限管理组件（可替换，测试用）。
   * @param options.captureManager 摄像头采集组件（可替换，测试用）。
   * @param options.mediaService 模型输入尺寸规则组件（可替换，测试用）。
   * @param options.errorListener 运行期错误回调。
   */
  constructor(options?: {
    permissionManager?: PermissionManaging;
    captureManager?: CameraCaptureManaging;
    mediaService?: MediaServicing;
    errorListener?: XmaxErrorListener;
  }) {
    this.permissionManager = options?.permissionManager ?? new PermissionManager();
    this.captureManager = options?.captureManager ?? new CameraCaptureManager();
    this.mediaService = options?.mediaService ?? new MediaService();
    this.errorListener = options?.errorListener ?? (() => {});
  }

  /** 当前活动的本地相机视频轨道；尚未创建时为空。 */
  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.activeTrack;
  }

  /** 当前相机流是否配置为使用麦克风。 */
  get useMicrophone(): boolean {
    return this.activeTrack !== undefined && this.storedUseMicrophone;
  }

  /** 设置当前相机流的一次性内部就绪处理；条件为已收到有效帧且预览已绑定。 */
  setPreviewReadyHandler(handler?: CameraPreviewReadyHandler): void {
    this.previewReadyHandler = handler;
    const track = this.activeTrack;
    if (track) {
      this.notifyPreviewReady(track);
    }
  }

  /**
   * 创建并启动本地相机流。
   *
   * @param options.videoFormat 期望的输出尺寸、帧率和编码配置；尺寸按模型规则调整。
   * @param options.position 首次启动时使用的摄像头位置。
   * @param options.useMicrophone 是否申请麦克风权限并允许实时连接时启动音频采集。
   * @returns 包含本地相机视频轨道的媒体流。
   * @throws 已有活动相机流、格式无效、权限不足或采集启动失败时抛出错误。
   */
  async createLocalCameraStream(options: {
    videoFormat: RealtimeVideoFormat;
    position: CameraPosition;
    useMicrophone: boolean;
  }): Promise<RealtimeMediaStream> {
    if (this.activeTrack) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Stop the current local camera stream before creating another one",
      );
    }
    const resolvedFormat = this.resolveVideoFormat(options.videoFormat);
    const track = new RealtimeVideoTrack({
      id: CameraController.localVideoTrackID,
      videoFormat: resolvedFormat,
      position: options.position,
    });

    try {
      await this.permissionManager.ensureCameraPermission();
      if (options.useMicrophone) {
        await this.permissionManager.ensureMicrophonePermission();
      }

      this.activeTrack = track;
      this.storedUseMicrophone = options.useMicrophone;
      this.hasCapturedFrame = false;
      this.isPreviewAttached = false;
      this.registerPreviewBinding(track);

      const mediaTrack = await this.captureManager.start({
        width: resolvedFormat.width,
        height: resolvedFormat.height,
        frameRate: resolvedFormat.fps,
        position: options.position,
        firstFrameListener: () => {
          if (this.activeTrack !== track) {
            return;
          }
          this.hasCapturedFrame = true;
          this.notifyPreviewReady(track);
        },
        errorListener: (error) => {
          if (this.activeTrack !== track) {
            return;
          }
          this.errorListener(error);
        },
      });
      track.mediaStreamTrack = mediaTrack;
      return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
    } catch (error) {
      await this.stopLocalCameraStream();
      throw XmaxError.from(error);
    }
  }

  /** 停止相机和麦克风采集，并释放当前轨道及本地预览资源。 */
  async stopLocalCameraStream(): Promise<void> {
    const track = this.activeTrack;
    this.activeTrack = undefined;
    this.previewReadyHandler = undefined;
    this.storedUseMicrophone = false;
    this.hasCapturedFrame = false;
    this.isPreviewAttached = false;

    await this.captureManager.stop();
    if (track) {
      VideoRenderRegistry.unregister(track);
      track.mediaStreamTrack = undefined;
    }
  }

  /**
   * 在前置和后置摄像头之间切换，保留当前视频轨道。
   *
   * @returns 包含更新后相机轨道的媒体流。
   * @throws 相机流尚未启动或设备切换失败时抛出错误。
   */
  async switchCamera(): Promise<RealtimeMediaStream> {
    const track = this.activeTrack;
    const position = track?.position;
    if (!track || !position) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Local camera preview is not started",
      );
    }
    const nextPosition =
      position === CameraPosition.front ? CameraPosition.back : CameraPosition.front;

    // 采集切换失败时旧设备保持不变。
    const mediaTrack = await this.captureManager.switchCamera(nextPosition);
    track.updatePosition(nextPosition);
    track.mediaStreamTrack = mediaTrack;
    return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
  }

  /** 为相机轨道注册预览渲染绑定：attach 时挂流、镜像并标记预览已绑定。 */
  private registerPreviewBinding(track: RealtimeVideoTrack): void {
    VideoRenderRegistry.register(track, {
      attachHandler: (view) => {
        const stream = this.captureManager.mediaStream;
        if (!stream) {
          throw new XmaxError(
            XmaxErrorCode.mediaError,
            "Camera capture is not running",
          );
        }
        view.isMirrored = track.position === CameraPosition.front;
        view.setMediaStream(stream);
        this.isPreviewAttached = true;
        this.notifyPreviewReady(track);
      },
      detachHandler: (view) => {
        view.setMediaStream(null);
        this.isPreviewAttached = false;
      },
    });
  }

  /** 满足"已收到有效帧且预览已绑定"时触发一次性就绪回调。 */
  private notifyPreviewReady(track: RealtimeVideoTrack): void {
    if (
      this.activeTrack !== track ||
      !this.hasCapturedFrame ||
      !this.isPreviewAttached ||
      !this.previewReadyHandler
    ) {
      return;
    }
    const handler = this.previewReadyHandler;
    this.previewReadyHandler = undefined;
    handler(() => this.activeTrack === track);
  }

  /** 按模型输入规则校验并解析目标视频规格。 */
  private resolveVideoFormat(videoFormat: RealtimeVideoFormat): RealtimeVideoFormat {
    videoFormat.validate();
    const targetSize = this.mediaService.resolveModelInputSize({
      width: videoFormat.width,
      height: videoFormat.height,
    });
    const resolvedFormat = videoFormat.resized(targetSize.width, targetSize.height);
    resolvedFormat.validate();
    return resolvedFormat;
  }
}
