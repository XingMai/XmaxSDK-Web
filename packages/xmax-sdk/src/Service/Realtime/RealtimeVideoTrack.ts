import { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import { RealtimeVideoFormat } from "./RealtimeVideoFormat";

export interface RealtimeVideoTrackInit {
  /** 视频轨道标识。 */
  id: string;

  /** 轨道当前使用的视频格式。 */
  videoFormat?: RealtimeVideoFormat;

  /** 本地相机轨道的摄像头位置。 */
  position?: CameraPosition;
}

/**
 * 实时视频轨道及其动态元数据。
 *
 * Web 版本额外持有 `MediaStreamTrack` 句柄（SDK 内部使用），
 * 渲染层通过它把画面绑定到 `<video>` 元素。
 */
export class RealtimeVideoTrack {
  // 轨道信息
  /** 视频轨道标识。 */
  readonly id: string;

  // 动态元数据
  private metadata: {
    videoFormat?: RealtimeVideoFormat;
    position?: CameraPosition;
  };

  // 平台资源
  /**
   * SDK 内部：轨道对应的 Web 媒体轨。
   * 本地轨道在采集启动后可用；远端轨道在订阅成功后可用。
   */
  mediaStreamTrack?: MediaStreamTrack;

  /**
   * 创建实时视频轨道。
   *
   * @param init.id 视频轨道标识。
   * @param init.videoFormat 轨道初始视频格式。
   * @param init.position 本地相机轨道的初始摄像头位置。
   */
  constructor(init: RealtimeVideoTrackInit) {
    this.id = init.id;
    this.metadata = {
      videoFormat: init.videoFormat,
      position: init.position,
    };
  }

  /** 当前视频轨道使用的视频格式。 */
  get videoFormat(): RealtimeVideoFormat | undefined {
    return this.metadata.videoFormat;
  }

  /** 本地相机轨道当前使用的摄像头位置。 */
  get position(): CameraPosition | undefined {
    return this.metadata.position;
  }

  /** 更新轨道视频格式。 @internal */
  updateVideoFormat(videoFormat: RealtimeVideoFormat): void {
    this.metadata.videoFormat = videoFormat;
  }

  /** 更新轨道摄像头位置。 @internal */
  updatePosition(position: CameraPosition): void {
    this.metadata.position = position;
  }
}
