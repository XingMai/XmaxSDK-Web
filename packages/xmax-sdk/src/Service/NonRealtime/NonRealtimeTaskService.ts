import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { ApiServicing } from "../Network/ApiServicing";
import {
  NonRealtimeQuality, NonRealtimeTaskStatus,
  type NonRealtimeResult, type NonRealtimeTask, type NonRealtimeTaskOptions,
  type NonRealtimeTaskListOptions, type NonRealtimeTaskPage,
} from "./NonRealtimeTask";

const SUPPORTED_FPS = new Set([8, 10, 12, 15, 16, 18, 20, 22, 24, 25, 30, 45, 48, 50, 60, 72, 90, 100, 120]);

/**
 * 非实时任务 HTTP 服务；负责协议校验及字段映射，不执行提交重试或轮询。
 */
export class NonRealtimeTaskService {
  /**
   * 网络依赖
   */
  private readonly api: ApiServicing;

  /**
   * 注入非实时任务使用的 API 服务。
   */
  constructor(api: ApiServicing) {
    this.api = api;
  }

  /**
   * 提交一次任务；请求结果不确定时也不自动重试，以免重复扣费。
   */
  async submitTask(options: NonRealtimeTaskOptions): Promise<NonRealtimeTask> {
    const model = options.model?.trim();
    if (options.model !== undefined && !model) {
      invalid("Model must not be empty");
    }
    const prompt = options.prompt.trim();
    if (!prompt || [...prompt].length > 1024) {
      invalid("Prompt must contain 1–1024 characters");
    }
    validateURL(options.videoPath);
    if (options.referencePath !== undefined) {
      validateURL(options.referencePath);
    }
    if (!Object.values(NonRealtimeQuality).includes(options.quality)) {
      invalid("Quality must be sd or hd");
    }
    if (options.fps !== undefined && !SUPPORTED_FPS.has(options.fps)) {
      invalid("Unsupported processing frame rate");
    }

    const payload = await this.api.post<unknown>("/offline-task", {
      ...(model === undefined ? {} : { model }),
      prompt,
      refVideoPath: options.videoPath.trim(),
      ...(options.referencePath === undefined ? {} : { refImagePath: options.referencePath.trim() }),
      quality: options.quality,
      ...(options.fps === undefined ? {} : { fps: options.fps }),
    });
    return parseTask(payload);
  }

  /**
   * 查询任务，校验返回 ID；signal 只取消本次 HTTP 查询，不取消服务端任务。
   */
  async getTask(taskUid: string, signal?: AbortSignal): Promise<NonRealtimeTask> {
    const uid = validateTaskUid(taskUid);
    const task = parseTask(await this.api.get<unknown>(`/offline-task/${encodeURIComponent(uid)}`, { signal }));
    if (task.uid !== uid) {
      malformed("Task UID does not match the request");
    }
    return task;
  }

  /**
   * 查询最多 100 个 ID，按首次出现顺序去重；任一任务不可用时整体失败。
   */
  async getTasks(taskUids: readonly string[]): Promise<readonly NonRealtimeTask[]> {
    if (taskUids.length < 1 || taskUids.length > 100) {
      invalid("Provide 1–100 task UIDs");
    }
    const uids = [...new Set(taskUids.map(validateTaskUid))];
    const payload = record(await this.api.post<unknown>("/offline-task/batch-query", { taskUids: uids }));
    const tasks = parseList(payload.list);
    if (tasks.length !== uids.length || tasks.some((task, index) => task.uid !== uids[index])) {
      malformed("Batch response does not match the requested task UIDs");
    }
    return tasks;
  }

  /**
   * 分页查询任务，不隐式加载其他页。
   */
  async listTasks(options: NonRealtimeTaskListOptions = {}): Promise<NonRealtimeTaskPage> {
    const pageNumber = options.pageNumber ?? 1;
    const pageSize = options.pageSize ?? 10;
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
      invalid("Page number must be a positive integer");
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      invalid("Page size must be between 1 and 100");
    }
    if (options.status !== undefined && !Object.values(NonRealtimeTaskStatus).includes(options.status)) {
      invalid("Invalid task status");
    }

    const query = new URLSearchParams({ pageNumber: String(pageNumber), pageSize: String(pageSize) });
    if (options.status !== undefined) {
      query.set("status", options.status);
    }
    const payload = record(await this.api.get<unknown>(`/offline-task/page?${query}`));
    return Object.freeze({
      pageNumber: pageInteger(payload, "pageNumber", 1),
      pageSize: pageInteger(payload, "pageSize", 1),
      total: pageInteger(payload, "total", 0),
      list: parseList(payload.list),
    });
  }
}

/**
 * 校验任务 ID，拒绝相对路径段以避免 URL 规范化改变请求目标。
 */
export function validateTaskUid(value: string): string {
  const uid = value.trim();
  if (!uid || uid === "." || uid === "..") {
    invalid("Task UID must not be empty or a relative path segment");
  }
  return uid;
}

/**
 * 仅校验网络 URL 格式；资源是否由 Xmax 上传必须由服务端核验。
 */
function validateURL(value: string): void {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return invalid("Resource must be an uploaded HTTP(S) URL");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    invalid("Resource must be an uploaded HTTP(S) URL");
  }
}

/**
 * 将参数错误映射为 SDK 配置错误。
 */
function invalid(message: string): never {
  throw new XmaxError(XmaxErrorCode.invalidConfiguration, message);
}

/**
 * 拒绝不可用的响应数据，避免把缺失状态当成永久处理中。
 */
function malformed(message = "Invalid non-realtime response data"): never {
  throw new XmaxError(XmaxErrorCode.apiError, message);
}

/**
 * 解析响应对象。
 */
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    malformed();
  }
  return value as Record<string, unknown>;
}

/**
 * 读取可空字段，保留缺失与数值 0 的区别。
 */
function field<T extends "string" | "number">(data: Record<string, unknown>, key: string, type: T): (T extends "string" ? string : number) | undefined {
  const value = data[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== type || (typeof value === "number" && (!Number.isFinite(value) || value < 0))) {
    malformed(`Invalid field: ${key}`);
  }
  return value as T extends "string" ? string : number;
}

/**
 * 校验分页响应中必需的整数。
 */
function pageInteger(data: Record<string, unknown>, key: string, minimum: number): number {
  const value = field(data, key, "number");
  if (value === undefined || !Number.isSafeInteger(value) || value < minimum) {
    malformed(`Invalid field: ${key}`);
  }
  return value;
}

/**
 * 将任务数组解析为不可变快照。
 */
function parseList(value: unknown): readonly NonRealtimeTask[] {
  if (!Array.isArray(value)) {
    malformed("Missing task list");
  }
  return Object.freeze(value.map(parseTask));
}

/**
 * 转换任务及结果字段，不补造服务端未提供的进度或失败原因。
 */
function parseTask(value: unknown): NonRealtimeTask {
  const data = record(value);
  const uid = field(data, "uid", "string");
  const status = field(data, "status", "string") as NonRealtimeTaskStatus;
  const quality = field(data, "quality", "string") as NonRealtimeQuality | undefined;
  if (!uid?.trim() || !Object.values(NonRealtimeTaskStatus).includes(status)) {
    malformed("Missing task UID or invalid status");
  }
  if (quality !== undefined && !Object.values(NonRealtimeQuality).includes(quality)) {
    malformed("Invalid task quality");
  }

  return Object.freeze({
    uid, status, quality,
    userUid: field(data, "userUid", "string"),
    prompt: field(data, "prompt", "string"),
    videoPath: field(data, "refVideoPath", "string"),
    referencePath: field(data, "refImagePath", "string"),
    processorId: field(data, "processorId", "string"),
    requestedFps: field(data, "requestedFps", "number"),
    resolvedFps: field(data, "resolvedFps", "number"),
    retryCount: field(data, "retryCount", "number"),
    videoDurationSeconds: field(data, "videoDurationSeconds", "number"),
    billableDurationSeconds: field(data, "billableDurationSeconds", "number"),
    chargePoints: field(data, "chargePoints", "number"),
    result: data.result == null ? undefined : parseResult(data.result),
    processStartTime: field(data, "processStartTime", "string"),
    createTimestamp: field(data, "createTimestamp", "string"),
    updateTimestamp: field(data, "updateTimestamp", "string"),
  });
}

/**
 * 将服务端 snake_case 结果转换成 SDK camelCase 字段。
 */
function parseResult(value: unknown): NonRealtimeResult {
  const data = record(value);
  return Object.freeze({
    url: field(data, "result_url", "string"),
    uploadError: field(data, "upload_error", "string"),
    uploadStatus: field(data, "upload_status", "string"),
    finalizeDurationMs: field(data, "finalize_duration_ms", "number"),
    compressionLevel: field(data, "compression_level", "string"),
    frameCount: field(data, "frame_count", "number"),
    fps: field(data, "fps", "number"),
    durationMs: field(data, "result_duration_ms", "number"),
    fileSizeBytes: field(data, "file_size_bytes", "number"),
    droppedFrameCount: field(data, "dropped_frame_count", "number"),
    originalFileSizeBytes: field(data, "original_file_size_bytes", "number"),
  });
}
