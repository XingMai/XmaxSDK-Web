import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { StreamControlling } from "../../Stream/StreamControlling";
import type { RoomEventTargetSize } from "../../Stream/Room/RoomEvent";
import { RealtimeCoordinator } from "./RealtimeCoordinator";

interface GenerationOptions {
  videoFormat: RealtimeVideoFormat;
  targetSize?: RoomEventTargetSize;
  context?: RealtimeContext;
}

/** 内部生成管理器：拥有生成任务与上下文，管理信令、确认和取消；不持有会话或公开状态。 */
export class XmaxRealtimeGenerationManager {
  private currentContext?: RealtimeContext;
  private activeTaskID?: string;
  private pendingStop?: { taskID: string; completion: Promise<void> };

  constructor(
    private readonly streamController: StreamControlling,
    private readonly taskIDGenerator: () => string = XmaxRealtimeGenerationManager.createTaskID,
  ) {}

  /** 首次请求在建立连接前校验条件；后续请求可复用缓存。 */
  validateContext(context?: RealtimeContext): RealtimeContext {
    const resolved = context ?? this.currentContext;
    if (!resolved) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "A realtime context is required for the first generation");
    }
    return resolved;
  }

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
        taskID, videoFormat: options.videoFormat, targetSize: options.targetSize, context,
      });
      await this.awaitConfirmation(confirmation, options.signal);
      options.ensureCurrent();
      this.currentContext = context;
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

  update(taskID: string | undefined, options: GenerationOptions): void {
    const context = options.context ?? this.currentContext;
    if (!taskID || !context) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "A realtime context is required to update the current generation");
    }
    this.streamController.updateGeneration({
      taskID, videoFormat: options.videoFormat, targetSize: options.targetSize, context,
    });
    this.currentContext = context;
  }

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

  async reset(taskID?: string): Promise<void> {
    this.currentContext = undefined;
    // Coordinator 进入 disconnecting 后可能不再携带 taskID，仍须停止本类持有的任务。
    await this.stop(this.activeTaskID ?? (taskID || undefined));
  }

  private async awaitConfirmation(confirmation: Promise<void>, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", abort);
      const abort = () => { cleanup(); reject(RealtimeCoordinator.cancelledError()); };
      confirmation.then(
        () => { cleanup(); resolve(); },
        (error) => { cleanup(); reject(error); },
      );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  /** 生成当前生成任务的唯一标识。 */
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
