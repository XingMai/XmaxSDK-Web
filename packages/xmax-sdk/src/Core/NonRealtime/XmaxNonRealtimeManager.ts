import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { NonRealtimeTaskService, validateTaskUid } from "../../Service/NonRealtime/NonRealtimeTaskService";
import { NonRealtimeTaskError } from "../../Service/NonRealtime/NonRealtimeTaskError";
import { NonRealtimeTaskStatus, type NonRealtimeTask, type NonRealtimeTaskOptions, type NonRealtimeTaskListOptions } from "../../Service/NonRealtime/NonRealtimeTask";
import type { NonRealtimeWaitOptions, XmaxNonRealtimeManaging } from "./XmaxNonRealtimeManaging";

/**
 * 非实时任务门面；复用 HTTP 服务，独立管理每一次等待，不创建 RTC 或实时会话。
 */
export class XmaxNonRealtimeManager implements XmaxNonRealtimeManaging {
  /**
   * 服务层组件
   */
  private readonly tasks: NonRealtimeTaskService;

  /**
   * 注入非实时任务服务。
   */
  constructor(tasks: NonRealtimeTaskService) {
    this.tasks = tasks;
  }

  /**
   * 单次提交任务，不自动重试可能已扣费的请求。
   */
  submitTask(options: NonRealtimeTaskOptions): Promise<NonRealtimeTask> {
    return this.tasks.submitTask(options);
  }

  /**
   * 取得任务快照，不把服务端失败终态当成查询失败。
   */
  getTask(taskUid: string, options?: { signal?: AbortSignal }): Promise<NonRealtimeTask> {
    return this.tasks.getTask(taskUid, options?.signal);
  }

  /**
   * 批量取得任务快照。
   */
  getTasks(taskUids: readonly string[]): Promise<readonly NonRealtimeTask[]> {
    return this.tasks.getTasks(taskUids);
  }

  /**
   * 分页取得任务列表。
   */
  listTasks(options?: NonRealtimeTaskListOptions) {
    return this.tasks.listTasks(options);
  }

  /**
   * 等待任务完成；查询串行执行，瞬时错误有限退避，取消与总超时覆盖请求及等待阶段。
   */
  async waitForCompletion(taskUid: string, options: NonRealtimeWaitOptions = {}): Promise<NonRealtimeTask> {
    const uid = validateTaskUid(taskUid);
    const interval = options.intervalMs ?? 2000;
    const retries = options.maxConsecutiveRetries ?? 3;
    validateDelay(interval);
    if (options.timeoutMs !== undefined) {
      validateDelay(options.timeoutMs);
    }
    if (!Number.isSafeInteger(retries) || retries < 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Retry count must be a non-negative integer",
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
    }
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      abort();
    }, options.timeoutMs);

    let failures = 0;
    try {
      for (;;) {
        ensureActive(controller.signal);
        let task: NonRealtimeTask;
        try {
          task = await this.tasks.getTask(uid, controller.signal);
        } catch (error) {
          ensureActive(controller.signal);
          if (!isTransient(error) || failures >= retries) {
            throw error;
          }
          failures++;
          await delay(Math.min(interval * 2 ** (failures - 1), 30_000), controller.signal);
          continue;
        }

        ensureActive(controller.signal);
        failures = 0;
        // 观察回调异常不改变服务器任务状态，也不触发重复提交或查询重试。
        try {
          void Promise.resolve(options.onTaskUpdated?.(task)).catch(() => {});
        } catch {
          // 接入方负责处理观察回调错误。
        }
        ensureActive(controller.signal);

        if (task.status === NonRealtimeTaskStatus.error) {
          throw new NonRealtimeTaskError(task, `Non-realtime task ${uid} failed`);
        }
        if (task.status === NonRealtimeTaskStatus.completed) {
          if (!isResultAvailable(task)) {
            throw new NonRealtimeTaskError(
              task,
              `Non-realtime task ${uid} completed without a usable result`,
            );
          }
          return task;
        }
        await delay(interval, controller.signal);
      }
    } catch (error) {
      if (timedOut) {
        throw new XmaxError(
          XmaxErrorCode.timeout,
          `Waiting for task ${uid} timed out; the server task was not cancelled`,
        );
      }
      ensureActive(controller.signal);
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

/**
 * 校验浏览器 setTimeout 可表示的正数时长。
 */
function validateDelay(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647) {
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Polling durations must be positive and within the timer range");
  }
}

/**
 * 统一取消错误，避免误表达为服务端任务取消。
 */
function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new XmaxError(
      XmaxErrorCode.cancelled,
      "Task wait was cancelled locally; the server task was not cancelled",
    );
  }
}

/**
 * 可取消的轮询间隔，完成后释放定时器及事件监听。
 */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      try {
        ensureActive(signal);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) {
      finish();
    }
  });
}

/**
 * 只重试查询中的网络异常、请求超时和没有明确业务拒绝码的服务器故障。
 */
function isTransient(error: unknown): boolean {
  if (!(error instanceof XmaxError)) {
    return false;
  }
  return error.code === XmaxErrorCode.networkError || error.code === XmaxErrorCode.timeout ||
    (error.code === XmaxErrorCode.apiError && (error.httpStatus ?? 0) >= 500 && (error.apiCode === undefined || error.apiCode === error.httpStatus));
}

/**
 * 完成必须有 HTTP(S) 结果地址，且没有明确的上传失败信息。
 */
function isResultAvailable(task: NonRealtimeTask): boolean {
  const result = task.result;
  if (
    !result?.url?.trim() ||
    result.uploadError?.trim() ||
    (result.uploadStatus !== undefined && result.uploadStatus !== "success")
  ) {
    return false;
  }
  try {
    const url = new URL(result.url);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
