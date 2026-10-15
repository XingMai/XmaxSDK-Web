import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { StreamControlling } from "../../Stream/StreamControlling";
import type { RoomEventTargetSize } from "../../Stream/Room/RoomEvent";
import { RealtimeCoordinator } from "./RealtimeCoordinator";
import type { InteractionControlling } from "../../Media/Interaction/InteractionControlling";
import type { RenderControlling } from "../../Render/RenderControlling";

interface GenerationOptions {
  faceRestoration?: boolean;
  videoFormat: RealtimeVideoFormat;
  targetSize?: RoomEventTargetSize;
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
    private readonly streamController: StreamControlling,
    private readonly interactionController: InteractionControlling,
    private readonly renderController: RenderControlling,
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
   * @param options.videoFormat 模型生成使用的视频规格。
   * @param options.targetSize 服务端生成后的回传尺寸，缺省使用生成尺寸。
   * @param options.context 生成条件，缺省复用最近缓存的上下文。
   * @param options.faceRestoration 是否回贴原始人脸，默认 false。
   * @param options.mirror 是否由后端水平翻转输入，默认 false；仅用于 start 信令。
   * @param options.signal 取消本次生成启动的信号。
   * @param options.ensureCurrent 校验当前操作仍有效。
   * @param options.waitUntilRemoteReady 等待远端生成流就绪。
   * @param options.onStartSent start 信令发送成功后的可选异步回调。
   */
  async start(options: GenerationOptions & {
    mirror?: boolean;
    signal: AbortSignal;
    ensureCurrent: () => void;
    waitUntilRemoteReady: () => Promise<void>;
    onStartSent?: () => Promise<void>;
  }): Promise<string> {
    const context = this.validateContext(options.context);
    options.ensureCurrent();

    const taskID = this.taskIDGenerator();
    this.activeTaskID = taskID;

    try {
      const confirmation = this.streamController.beginGeneration({
        taskID, videoFormat: options.videoFormat, context,
        ...(options.targetSize && { targetSize: options.targetSize }),
        mirror: options.mirror ?? false,
        faceRestoration: options.faceRestoration ?? false,
        ...(options.onStartSent && { onStartSent: options.onStartSent }),
      });
      await this.awaitConfirmation(confirmation, options.signal);
      options.ensureCurrent();
      this.currentContext = context;

      // 生成确认后再等待远端轨道就绪，并应用远端音频配置。
      await options.waitUntilRemoteReady();
      options.ensureCurrent();

      await this.streamController.activateRemoteAudio();
      options.ensureCurrent();

      this.interactionController.startInteraction(taskID, options.videoFormat);
      this.renderController.setInteractionEnabled(true, options.videoFormat);
      return taskID;
    } catch (error) {
      await this.stop(taskID);
      throw error;
    }
  }

  /**
   * 更新活动任务的生成条件；信令发送成功后才覆盖缓存，无任务或上下文时抛错。
   * @param taskID 当前活动任务标识。
   * @param options.videoFormat 模型生成使用的视频规格。
   * @param options.targetSize 服务端生成后的回传尺寸。
   * @param options.context 生成条件，缺省复用最近缓存的上下文。
   * @param options.faceRestoration 是否回贴原始人脸，默认 false。
   */
  async update(taskID: string | undefined, options: GenerationOptions): Promise<void> {
    const context = options.context ?? this.currentContext;
    if (!taskID || !context) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "A realtime context is required to update the current generation");
    }

    await this.streamController.updateGeneration({
      taskID, videoFormat: options.videoFormat, context,
      faceRestoration: options.faceRestoration ?? false,
      ...(options.targetSize && { targetSize: options.targetSize }),
    });
    if (this.activeTaskID !== taskID) throw RealtimeCoordinator.cancelledError();
    this.currentContext = context;
    this.interactionController.startInteraction(taskID, options.videoFormat);
    this.renderController.setInteractionEnabled(true, options.videoFormat);
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
    this.interactionController.stopInteraction();
    this.renderController.setInteractionEnabled(false);
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
    this.interactionController.stopInteraction();
    this.renderController.setInteractionEnabled(false);
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
