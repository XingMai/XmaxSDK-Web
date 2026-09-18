import type { XmaxErrorListener } from "../../Errors/XmaxError";
import type { CameraPosition } from "./CameraPosition";

export interface CameraCaptureStartOptions {
  /** 期望的采集宽度（按模型规则调整后的尺寸）。 */
  width: number;

  /** 期望的采集高度。 */
  height: number;

  /** 期望的采集帧率。 */
  frameRate: number;

  /** 首次启动时使用的摄像头位置。 */
  position: CameraPosition;

  /** 首个有效帧到达时调用（一次性）。 */
  firstFrameListener: () => void;

  /** 采集运行期错误回调（如设备断开）。 */
  errorListener: XmaxErrorListener;
}

/**
 * 定义本地摄像头采集能力。
 *
 * 采集以 `MediaStreamTrack` 为单位产出；
 * 首帧通过 track 的 `unmute` 事件探测，帧推送在 RTC 层以 track 注入完成。
 */
export interface CameraCaptureManaging {
  /** 当前采集使用的媒体流；未启动时为空。 */
  readonly mediaStream?: MediaStream;

  /** 当前采集的视频轨；未启动时为空。 */
  readonly currentVideoTrack?: MediaStreamTrack;

  /**
   * 启动摄像头采集。
   * @throws 已在采集、设备不可用或权限被拒绝时抛出错误。
   */
  start(options: CameraCaptureStartOptions): Promise<MediaStreamTrack>;

  /**
   * 在前置和后置摄像头之间切换，复用当前媒体流。
   * @throws 采集未启动或设备切换失败时抛出错误。
   */
  switchCamera(to: CameraPosition): Promise<MediaStreamTrack>;

  /** 停止采集并释放设备。 */
  stop(): Promise<void>;
}
