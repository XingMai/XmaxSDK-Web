/**
 * 服务端读取网络视频时使用的采样方式。
 */
export enum RealtimeVideoSampleMethod {
  time = "time",
  fps = "fps",
}

/**
 * 服务端可直接访问的网络视频及采样配置。
 */
export interface RealtimeReferenceVideo {
  /**
   * HTTP 或 HTTPS 视频地址。
   */
  readonly path: string;

  /**
   * 服务端采样方式。
   */
  readonly sampleMethod: RealtimeVideoSampleMethod;
}
