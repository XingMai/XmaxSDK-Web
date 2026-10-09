/**
 * 非实时视频的输出质量。
 */
export enum NonRealtimeQuality {
  sd = "sd",
  hd = "hd",
}

/**
 * 服务端任务状态；上传进度不属于任务状态。
 */
export enum NonRealtimeTaskStatus {
  submitted = "submitted",
  processing = "processing",
  completed = "completed",
  error = "error",
}

/**
 * 提交非实时任务的参数；资源必须来自 Xmax 上传流程，不能使用 blob URL 或本地路径。
 */
export interface NonRealtimeTaskOptions {
  /**
   * 模型标识。
   */
  model: string;
  /**
   * 已上传源视频的 URL。
   */
  videoPath: string;
  /**
   * 生成指令；去除首尾空白后为 1–1024 个字符。
   */
  prompt: string;
  /**
   * 已上传参考图片的 URL；省略表示不使用参考图。
   */
  referencePath?: string;
  /**
   * 输出质量。
   */
  quality: NonRealtimeQuality;
  /**
   * 可选的处理帧率；仅接受协议支持的整数，省略时沿用源视频帧率（含小数）。
   */
  fps?: number;
}

/**
 * 非实时生成结果；缺失或 null 的服务端字段规范化为 undefined。
 */
export interface NonRealtimeResult {
  readonly url?: string;
  readonly uploadError?: string;
  readonly uploadStatus?: string;
  readonly finalizeDurationMs?: number;
  readonly compressionLevel?: string;
  readonly frameCount?: number;
  readonly fps?: number;
  readonly durationMs?: number;
  readonly fileSizeBytes?: number;
  readonly droppedFrameCount?: number;
  readonly originalFileSizeBytes?: number;
}

/**
 * 非实时任务快照；uid 和 status 为 SDK 查询、恢复及轮询所需字段。
 * 时间戳保持服务端原始字符串，不推断时区。
 */
export interface NonRealtimeTask {
  readonly uid: string;
  readonly status: NonRealtimeTaskStatus;
  readonly userUid?: string;
  readonly prompt?: string;
  readonly videoPath?: string;
  readonly referencePath?: string;
  readonly processorId?: string;
  readonly quality?: NonRealtimeQuality;
  readonly requestedFps?: number;
  readonly resolvedFps?: number;
  readonly retryCount?: number;
  readonly videoDurationSeconds?: number;
  readonly billableDurationSeconds?: number;
  readonly chargePoints?: number;
  readonly result?: NonRealtimeResult;
  readonly processStartTime?: string;
  readonly createTimestamp?: string;
  readonly updateTimestamp?: string;
}

/**
 * 分页查询选项。
 */
export interface NonRealtimeTaskListOptions {
  /**
   * 从 1 开始的页码，默认 1。
   */
  pageNumber?: number;
  /**
   * 每页数量，1–100，默认 10。
   */
  pageSize?: number;
  /**
   * 可选的任务状态筛选。
   */
  status?: NonRealtimeTaskStatus;
}

/**
 * 按创建时间从新到旧排列的任务页。
 */
export interface NonRealtimeTaskPage {
  readonly pageNumber: number;
  readonly pageSize: number;
  readonly total: number;
  readonly list: readonly NonRealtimeTask[];
}
