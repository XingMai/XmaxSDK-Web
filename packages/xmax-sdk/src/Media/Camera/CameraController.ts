import { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import { waitForValidCameraFrame } from "../../Foundation/Media/Camera/CameraFrameValidator";
import { XmaxError, XmaxErrorCode, type XmaxErrorListener } from "../../Foundation/Errors/XmaxError";
import type { PermissionManaging } from "../../Foundation/Permissions/PermissionManaging";
import { PermissionManager } from "../../Foundation/Permissions/PermissionManager";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import { RtcManager } from "../../Foundation/RTC/RtcManager";
import { VideoRenderRegistry } from "../../Service/Realtime/VideoRenderBinding";
import type { MediaServicing } from "../../Service/Media/MediaServicing";
import { MediaService } from "../../Service/Media/MediaService";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import type { CameraControlling, CameraPreviewReadyHandler } from "./CameraControlling";

/**
 * 协调摄像头采集和 SDK 本地预览。
 *
 * 采集由 RTC 层完成（只采不发），控制器把采集视频轨装入
 * `MediaStream` 后挂到预览视图；切换摄像头时原位替换流内视频轨，
 * 已挂载的视图无需重新绑定。麦克风在实时连接建立时由 RTC 层启动
 * （M2 接入），当前仅维护配置与权限。
 */
export class CameraController implements CameraControlling {
  // 轨道标识
  private static readonly localVideoTrackID = "video0";

  // 基础层组件
  private readonly permissionManager: PermissionManaging;
  private readonly rtcManager: RtcManaging;

  // 服务层组件
  private readonly mediaService: MediaServicing;

  // 事件监听
  private readonly errorListener: XmaxErrorListener;
  private previewReadyHandler?: CameraPreviewReadyHandler;

  // 本地资源
  private activeTrack?: RealtimeVideoTrack;
  private previewStream?: MediaStream;
  private previewMirrorApplier?: (mirrored: boolean) => void;

  // 预览状态
  private hasCapturedFrame = false;
  private isPreviewAttached = false;

  // 麦克风配置
  private storedUseMicrophone = false;

  /**
   * 创建相机控制器。
   *
   * @param options.permissionManager 权限管理组件（可替换，测试用）。
   * @param options.rtcManager RTC 引擎与采集组件（可替换，测试用）。
   * @param options.mediaService 模型输入尺寸规则组件（可替换，测试用）。
   * @param options.errorListener 运行期错误回调。
   */
  constructor(options?: {
    permissionManager?: PermissionManaging;
    rtcManager?: RtcManaging;
    mediaService?: MediaServicing;
    errorListener?: XmaxErrorListener;
  }) {
    this.permissionManager = options?.permissionManager ?? new PermissionManager();
    this.rtcManager = options?.rtcManager ?? new RtcManager();
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

  async waitForValidCameraFrame(signal: AbortSignal): Promise<void> {
    const track = this.activeTrack;
    const mediaTrack = track?.mediaStreamTrack;
    if (!mediaTrack) throw new XmaxError(XmaxErrorCode.mediaError, "Camera capture is not running");
    await waitForValidCameraFrame(mediaTrack, signal);
    if (this.activeTrack !== track || track.mediaStreamTrack !== mediaTrack) {
      throw new XmaxError(XmaxErrorCode.cancelled, "Camera track changed during exposure check");
    }
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
      await this.rtcManager.initialize();

      this.activeTrack = track;
      this.storedUseMicrophone = options.useMicrophone;
      this.hasCapturedFrame = false;
      this.isPreviewAttached = false;
      this.registerPreviewBinding(track);

      const mediaTrack = await this.rtcManager.startCameraCapture({
        width: resolvedFormat.width,
        height: resolvedFormat.height,
        frameRate: resolvedFormat.fps,
        position: options.position,
      });
      track.mediaStreamTrack = mediaTrack;
      this.previewStream = new MediaStream([mediaTrack]);
      this.observeMediaTrack(track, mediaTrack);
      return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
    } catch (error) {
      await this.stopLocalCameraStream();
      throw XmaxError.from(error);
    }
  }

  /** 停止相机采集并销毁 RTC 引擎，释放当前轨道及本地预览资源。 */
  async stopLocalCameraStream(): Promise<void> {
    const track = this.activeTrack;
    this.activeTrack = undefined;
    this.previewReadyHandler = undefined;
    this.previewStream = undefined;
    this.previewMirrorApplier = undefined;
    this.storedUseMicrophone = false;
    this.hasCapturedFrame = false;
    this.isPreviewAttached = false;

    await this.rtcManager.stopCameraCapture();
    await this.rtcManager.destroy();
    if (track) {
      VideoRenderRegistry.unregister(track);
      track.mediaStreamTrack = undefined;
    }
  }

  /**
   * 在前置和后置摄像头之间切换，保留当前视频轨道。
   *
   * 新视频轨原位替换预览流中的旧轨（旧轨由 RTC 层释放，此处不
   * 主动停止），已挂载的预览视图无需重新绑定。
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
    const mediaTrack = await this.rtcManager.switchCameraCapture(nextPosition);
    const previousTrack = track.mediaStreamTrack;
    track.updatePosition(nextPosition);
    track.mediaStreamTrack = mediaTrack;
    if (this.previewStream) {
      if (previousTrack) {
        this.previewStream.removeTrack(previousTrack);
      }
      this.previewStream.addTrack(mediaTrack);
    }
    this.previewMirrorApplier?.(nextPosition === CameraPosition.front);
    this.observeMediaTrack(track, mediaTrack);
    return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
  }

  /** 为相机轨道注册预览渲染绑定：attach 时挂流、镜像并标记预览已绑定。 */
  private registerPreviewBinding(track: RealtimeVideoTrack): void {
    VideoRenderRegistry.register(track, {
      attachHandler: (view) => {
        const stream = this.previewStream;
        if (!stream) {
          throw new XmaxError(
            XmaxErrorCode.mediaError,
            "Camera capture is not running",
          );
        }
        view.isMirrored = track.position === CameraPosition.front;
        view.setMediaStream(stream);
        this.previewMirrorApplier = (mirrored) => {
          view.isMirrored = mirrored;
        };
        this.isPreviewAttached = true;
        this.notifyPreviewReady(track);
      },
      detachHandler: (view) => {
        view.setMediaStream(null);
        this.previewMirrorApplier = undefined;
        this.isPreviewAttached = false;
      },
    });
  }

  /** 监听媒体轨首帧与意外结束：首帧推进预览就绪，意外结束上报错误。 */
  private observeMediaTrack(
    track: RealtimeVideoTrack,
    mediaTrack: MediaStreamTrack,
  ): void {
    const isCurrent = () =>
      this.activeTrack === track && track.mediaStreamTrack === mediaTrack;
    if (mediaTrack.muted) {
      mediaTrack.addEventListener(
        "unmute",
        () => {
          if (!isCurrent()) {
            return;
          }
          this.hasCapturedFrame = true;
          this.notifyPreviewReady(track);
        },
        { once: true },
      );
    } else {
      this.hasCapturedFrame = true;
      this.notifyPreviewReady(track);
    }
    mediaTrack.addEventListener("ended", () => {
      if (!isCurrent()) {
        return;
      }
      this.errorListener(
        new XmaxError(
          XmaxErrorCode.mediaError,
          "Camera video track ended unexpectedly",
        ),
      );
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
