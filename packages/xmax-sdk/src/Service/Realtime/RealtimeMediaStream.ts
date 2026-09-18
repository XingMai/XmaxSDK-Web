import { RealtimeVideoTrack } from "./RealtimeVideoTrack";

/**
 * 实时生成输入/输出的媒体流。
 */
export class RealtimeMediaStream {
  /** 媒体流标识。 */
  readonly id: string;

  /** 媒体流包含的视频轨道。 */
  readonly videoTrack?: RealtimeVideoTrack;

  /**
   * 创建实时媒体流。
   *
   * @param init.id 媒体流标识。
   * @param init.videoTrack 媒体流包含的视频轨道。
   */
  constructor(init: { id: string; videoTrack?: RealtimeVideoTrack }) {
    this.id = init.id;
    this.videoTrack = init.videoTrack;
  }
}
