import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { StreamControlling } from "../../Stream/StreamControlling";
import { RealtimeCoordinator } from "./RealtimeCoordinator";

interface GenerationOptions {
  videoFormat: RealtimeVideoFormat;
  context?: RealtimeContext;
}

/**
 * 内部生成管理器：拥有生成任务与上下文，管理信令、确认和取消；不持有会话或公开状态。
 */
export class XmaxRealtimeGenerationManager {
  /**
   * 当前生成条件与任务标识
   */
  private currentContext?: RealtimeContext;
  private activeTaskID?: string;

  /**
   * 并发停止操作的共享结果
   */
  private pendingStop?: { taskID: string; completion: Promise<void> };

  /**
   * 注入房间传输组件和任务标识生成器，不创建会话或启动生成。
   */
  constructor(
    /**
     * 传输依赖与标识生成策略
     */
    private readonly streamController: StreamControlling,
    private readonly taskIDGenerator: () => string = XmaxRealtimeGenerationManager.createTaskID,
  ) {}

  /**
   * 首次请求在建立连接前校验条件；后续请求可复用缓存。
   */
  validateContext(context?: RealtimeContext): RealtimeContext {
    const resolved = context ?? this.currentContext;
    if (!resolved) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "A realtime context is required for the first generation");
    }
    return resolved;
  }

  /**
   * 发送生成指令并等待确认、远端就绪和音频激活，成功后返回任务标识。
   * 条件上下文在生成确认后缓存；启动失败时尽力停止本次任务并保留原始错误。
   */
  async start(options: GenerationOptions & {
    signal: AbortSignal;
    ensureCurrent: () => void;
    waitUntilRemoteReady: () => Promise<void>;
  }): Promise<string> {
    const context = this.validateContext(options.context);
    options.ensureCurrent();

    const taskID = this.taskIDGenerator();
    this.activeTaskID = taskID;

    try {
      const confirmation = this.streamController.beginGeneration({
        taskID, videoFormat: options.videoFormat, context,
      });
      await this.awaitConfirmation(confirmation, options.signal);
      options.ensureCurrent();
      this.currentContext = context;

      // 生成确认后再等待远端轨道就绪，并应用远端音频配置。
      await options.waitUntilRemoteReady();
      options.ensureCurrent();

      await this.streamController.activateRemoteAudio();
      options.ensureCurrent();

      return taskID;
    } catch (error) {
      await this.stop(taskID);
      throw error;
    }
  }

  /**
   * 更新活动任务的生成条件；信令发送成功后才覆盖缓存，无任务或上下文时抛错。
   */
  update(taskID: string | undefined, options: GenerationOptions): void {
    const context = options.context ?? this.currentContext;
    if (!taskID || !context) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "A realtime context is required to update the current generation");
    }

    this.streamController.updateGeneration({
      taskID, videoFormat: options.videoFormat, context,
    });
    this.currentContext = context;
  }

  /**
   * 幂等停止指定活动任务；并发调用共享结果，停止失败仅记录日志。
   */
  async stop(taskID = this.activeTaskID): Promise<void> {
    // 取消与统一清理可能同时到达：共享停止结果，不重复发送，也不提前退房。
    if (this.pendingStop && (!taskID || this.pendingStop.taskID === taskID)) {
      return this.pendingStop.completion;
    }
    if (!taskID || this.activeTaskID !== taskID) return;

    this.activeTaskID = undefined;
    const completion = (async () => {
      try {
        await this.streamController.stopGeneration(taskID);
      } catch (error) {
        XmaxLogger.realtime.error(() => `停止生成任务失败 (Failed to Stop Generation Task)\n└─ ${XmaxError.from(error).message}`);
      }
    })();
    this.pendingStop = { taskID, completion };

    try {
      await completion;
    } finally {
      if (this.pendingStop?.completion === completion) this.pendingStop = undefined;
    }
  }

  /**
   * 清空缓存的生成条件并等待活动任务停止，供断连和关闭流程使用。
   */
  async reset(taskID?: string): Promise<void> {
    this.currentContext = undefined;
    // Coordinator 进入 disconnecting 后可能不再携带 taskID，仍须停止本类持有的任务。
    await this.stop(this.activeTaskID ?? (taskID || undefined));
  }

  /**
   * 等待生成确认；取消时立即拒绝，并在所有结束路径移除取消监听。
   */
  private async awaitConfirmation(confirmation: Promise<void>, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", abort);
      const abort = () => {
        cleanup();
        reject(RealtimeCoordinator.cancelledError());
      };

      confirmation.then(
        () => {
          cleanup();
          resolve();
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );

      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  /**
   * 生成当前生成任务的唯一标识。
   */
  private static createTaskID(): string {
    const hex = crypto.randomUUID().replace(/-/g, "");
    let binary = "";
    for (let index = 0; index < 16; index += 1) {
      binary += String.fromCharCode(parseInt(hex.slice(index * 2, index * 2 + 2), 16));
    }

    const base64url = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    return `task-${base64url}?os=web`;
  }
}
