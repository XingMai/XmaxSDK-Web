import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import {
  RealtimeConnectionState,
  RealtimeReason,
  RealtimeState,
  type RealtimeStateListener,
} from "../../Service/Realtime/RealtimeState";
import type { RealtimeErrorHandler } from "./RealtimeErrorHandler";

/** 实时操作类型；同一时刻只允许一个操作。 */
export enum RealtimeOperationKind {
  media = "media",
  connection = "connection",
  generation = "generation",
  cameraSwitch = "cameraSwitch",

  /** 更新生成条件或回传尺寸，不改变生成生命周期。 */
  configuration = "configuration",
}

/** 资源清理范围；值越大范围越广，并发终止请求合并为最大范围。 */
export enum RealtimeTerminationScope {
  connection = 0,
  all = 1,
}

/** 判断终止范围是否影响指定类型的操作。 */
function scopeAffects(
  scope: RealtimeTerminationScope,
  kind: RealtimeOperationKind,
): boolean {
  if (scope === RealtimeTerminationScope.all) {
    return true;
  }
  return kind !== RealtimeOperationKind.media;
}

/** 清理完成后的残留资源信息。 */
export interface RealtimeCleanupResult {
  sessionID?: string;
  hasLocalMedia: boolean;
}

/** 分级资源清理的执行体，由 Manager 提供。 */
export type RealtimeCleanupHandler = (
  scope: RealtimeTerminationScope,
  taskID: string,
) => Promise<RealtimeCleanupResult>;

/** 操作租约：更新失败清理范围、校验操作仍拥有实时生命周期。 */
export interface RealtimeOperationToken {
  /** 更新当前操作失败或被调用方取消时需要释放的资源范围。 */
  setFailureScope(scope: RealtimeTerminationScope): void;

  /** 在异步边界后校验当前操作仍拥有实时生命周期。 */
  ensureCurrent(): void;

  /** 供必须同步返回的底层有效性回调读取操作状态。 */
  readonly isCurrent: boolean;

  /** 操作被取消时触发中止（供 fetch 等可中断调用使用）。 */
  readonly signal: AbortSignal;
}

class OperationLease implements RealtimeOperationToken {
  // 并发状态
  private valid = true;
  private terminalError?: XmaxError;
  private storedFailureScope?: RealtimeTerminationScope;
  private readonly abortController = new AbortController();

  constructor(failureScope?: RealtimeTerminationScope) {
    this.storedFailureScope = failureScope;
  }

  get isCurrent(): boolean {
    return this.valid;
  }

  get failure(): XmaxError | undefined {
    return this.terminalError;
  }

  get failureScope(): RealtimeTerminationScope | undefined {
    return this.storedFailureScope;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /** 更新当前操作失败或被调用方取消时需要释放的资源范围。 */
  setFailureScope(scope: RealtimeTerminationScope): void {
    this.storedFailureScope = scope;
  }

  /** 作废租约并触发中止信号；首个终止原因被保留。 */
  invalidate(error?: XmaxError): void {
    this.valid = false;
    if (!this.terminalError) {
      this.terminalError = error;
    }
    this.abortController.abort();
  }

  /** 在异步边界后校验当前操作仍拥有实时生命周期。 */
  ensureCurrent(): void {
    if (!this.valid) {
      throw this.terminalError ?? RealtimeCoordinator.cancelledError();
    }
  }
}

interface Operation {
  id: string;
  kind: RealtimeOperationKind;
  lease: OperationLease;
  completion: Promise<void>;
  terminationTask?: Promise<void>;
}

interface Termination {
  id: string;
  target: RealtimeTerminationScope;
  reason: RealtimeReason;
  error?: XmaxError;
  sessionID?: string;
  waitForOperations: Array<() => Promise<void>>;
  task: Promise<void>;
}

let operationSequence = 0;

/**
 * 统一管理实时操作准入、状态提交和分级资源清理。
 * 在 JS 单线程事件循环下以 Promise 链和操作租约实现串行化语义。
 */
export class RealtimeCoordinator {
  // 业务组件
  private readonly errorHandler: RealtimeErrorHandler;
  private readonly cleanup: RealtimeCleanupHandler;

  // 状态管理
  private state = new RealtimeState({
    connectionState: RealtimeConnectionState.idle,
  });
  private stateListener?: RealtimeStateListener;

  // 操作管理
  private activeOperation?: Operation;
  private termination?: Termination;

  constructor(options: {
    errorHandler: RealtimeErrorHandler;
    cleanup: RealtimeCleanupHandler;
  }) {
    this.errorHandler = options.errorHandler;
    this.cleanup = options.cleanup;
  }

  /** 当前实时状态快照。 */
  get currentState(): RealtimeState {
    return this.state;
  }

  /**
   * 设置实时状态监听器；设置后立即回放当前状态。
   *
   * @param listener 实时状态回调；传入 `undefined` 时清除监听器。
   */
  async setStateListener(listener?: RealtimeStateListener): Promise<void> {
    this.stateListener = listener;
    if (listener) {
      listener(this.state);
    }
  }

  /**
   * 接纳并执行一个实时操作，同一时刻只允许一个。生命周期操作取消时先完成
   * 对应范围的资源清理；仅取消参数更新不会停止当前生成。
   *
   * @param kind 操作类型。
   * @param failureScope 操作失败时需要自动释放的资源范围；不传则失败仅上报。
   * @param body 操作执行体，通过租约校验异步边界后的有效性。
   * @returns 操作执行结果。
   * @throws 已有活跃操作或终止进行中时抛出 `invalidConfiguration`。
   */
  async run<Value>(
    kind: RealtimeOperationKind,
    failureScope: RealtimeTerminationScope | undefined,
    body: (token: RealtimeOperationToken) => Promise<Value>,
  ): Promise<Value> {
    if (this.termination || this.activeOperation) {
      const error = new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Another realtime operation is in progress; wait for it to finish",
      );
      await this.errorHandler.report(error);
      throw error;
    }

    // 已在生成时，startGeneration 只更新条件，与回传尺寸调整共用配置操作。
    const operationKind =
      kind === RealtimeOperationKind.generation &&
      this.state.connectionState === RealtimeConnectionState.generating
        ? RealtimeOperationKind.configuration
        : kind;

    const lease = new OperationLease(failureScope);
    const resultPromise = (async () => body(lease))();
    const operation: Operation = {
      id: `op-${(operationSequence += 1)}`,
      kind: operationKind,
      lease,
      completion: resultPromise.then(
        () => undefined,
        () => undefined,
      ),
    };
    this.activeOperation = operation;

    try {
      const value = await resultPromise;
      lease.ensureCurrent();
      this.finish(operation);
      return value;
    } catch (error) {
      return this.handleFailure(error, operation);
    }
  }

  /** 仅当前操作可以提交新的公开状态。 */
  async commit(
    nextState: RealtimeState,
    token: RealtimeOperationToken,
  ): Promise<void> {
    token.ensureCurrent();
    await this.setState(nextState);
  }

  /** 当前本地预览满足就绪条件后，结束媒体准备状态。 */
  async localPreviewDidBecomeReady(isCurrent: () => boolean): Promise<void> {
    if (
      this.state.connectionState !== RealtimeConnectionState.preparing ||
      !isCurrent()
    ) {
      return;
    }
    await this.setState(
      new RealtimeState({ connectionState: RealtimeConnectionState.ready }),
    );
  }

  /** 断开实时连接；尚未提交连接状态的活跃操作也会被取消。 */
  async disconnect(reason: RealtimeReason = RealtimeReason.normal): Promise<void> {
    const task = await this.beginDisconnect(reason);
    await task;
  }

  /** 发起断开并返回收尾任务，使本地媒体调整不必等待网络资源释放。 */
  async beginDisconnect(
    reason: RealtimeReason,
  ): Promise<Promise<void> | undefined> {
    const hasConnectionOperation = this.activeOperation
      ? scopeAffects(RealtimeTerminationScope.connection, this.activeOperation.kind)
      : false;
    const state = this.state.connectionState;
    const needsDisconnect =
      hasConnectionOperation ||
      this.termination !== undefined ||
      (state !== RealtimeConnectionState.idle &&
        state !== RealtimeConnectionState.preparing &&
        state !== RealtimeConnectionState.ready);
    if (!needsDisconnect) {
      return undefined;
    }
    return this.requestTermination(
      RealtimeTerminationScope.connection,
      undefined,
      reason,
    );
  }

  /** 终止指定范围并等待资源清理完成；并发终止请求会合并为最大范围。 */
  async terminate(
    target: RealtimeTerminationScope,
    reason: RealtimeReason = RealtimeReason.normal,
  ): Promise<void> {
    const task = await this.requestTermination(target, undefined, reason);
    await task;
  }

  /** 清理仍属于当前生命周期的后台故障，并通过最终状态提供原因。 */
  async terminateWithError(
    error: XmaxError,
    target: RealtimeTerminationScope,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isCurrent()) {
      return;
    }
    // 清理期间的远端迟到错误不覆盖主动结束；本地媒体终止仍需扩大释放范围。
    if (this.termination && target !== RealtimeTerminationScope.all) {
      return;
    }
    const task = await this.requestTermination(
      target,
      error,
      RealtimeReason.failure(error),
    );
    await task;
  }

  /** 操作失败处理：取消走终止流程，错误按失败范围清理或直接上报。 */
  private async handleFailure<Value>(
    error: unknown,
    operation: Operation,
  ): Promise<Value> {
    const operationWasCancelled =
      (error instanceof XmaxError && error.code === XmaxErrorCode.cancelled) ||
      (error instanceof DOMException && error.name === "AbortError") ||
      !operation.lease.isCurrent;

    if (operationWasCancelled) {
      // 取消配置请求本身不停止生成；外部断开或关闭仍按已有终止流程等待收尾。
      if (
        (operation.kind === RealtimeOperationKind.configuration ||
          operation.lease.failureScope === undefined) &&
        operation.terminationTask === undefined &&
        this.termination === undefined
      ) {
        this.finish(operation);
        if (
          operation.kind === RealtimeOperationKind.media &&
          this.state.connectionState === RealtimeConnectionState.preparing
        ) {
          await this.setState(
            new RealtimeState({ connectionState: RealtimeConnectionState.idle }),
          );
        }
        throw RealtimeCoordinator.cancelledError();
      }
      const terminationTask =
        operation.terminationTask ??
        this.termination?.task ??
        (await this.requestTermination(
          operation.lease.failureScope ?? RealtimeTerminationScope.connection,
          undefined,
          RealtimeReason.normal,
          operation,
        ));
      await terminationTask;
      this.finish(operation);
      throw operation.lease.failure ?? RealtimeCoordinator.cancelledError();
    }

    const resolvedError = XmaxError.from(error);
    if (
      operation.kind !== RealtimeOperationKind.configuration &&
      operation.lease.failureScope !== undefined
    ) {
      const terminationTask = await this.requestTermination(
        operation.lease.failureScope,
        resolvedError,
        RealtimeReason.failure(resolvedError),
        operation,
      );
      await terminationTask;
    } else {
      this.finish(operation);
      if (
        operation.kind === RealtimeOperationKind.media &&
        this.state.connectionState === RealtimeConnectionState.preparing
      ) {
        await this.setState(
          new RealtimeState({ connectionState: RealtimeConnectionState.idle }),
        );
      }
      await this.errorHandler.report(resolvedError);
      throw resolvedError;
    }
    this.finish(operation);
    throw resolvedError;
  }

  /** 发起或合并终止请求，作废旧操作并进入断开中状态。 */
  private async requestTermination(
    target: RealtimeTerminationScope,
    error: XmaxError | undefined,
    reason: RealtimeReason,
    origin?: Operation,
  ): Promise<Promise<void>> {
    let pending = this.termination;
    if (pending) {
      if (target > pending.target) {
        pending.target = target;
      }
      if (!pending.error) {
        pending.error = error;
      }
      if (error && pending.error === error) {
        pending.reason = RealtimeReason.failure(error);
      }
    } else {
      pending = {
        id: `term-${(operationSequence += 1)}`,
        target,
        reason,
        error,
        waitForOperations: [],
        task: Promise.resolve(),
      };
      this.termination = pending;
      pending.task = this.performTermination(pending.id);
    }

    const active = this.activeOperation;
    if (active && active !== origin && scopeAffects(pending.target, active.kind)) {
      active.lease.invalidate(pending.error);
      active.terminationTask = pending.task;
      pending.waitForOperations.push(() => active.completion);
    } else if (origin) {
      origin.lease.invalidate(error);
      origin.terminationTask = pending.task;
      pending.waitForOperations.push(() => origin.completion);
    }

    await this.setState(
      new RealtimeState({
        connectionState: RealtimeConnectionState.disconnecting,
        sessionID: this.state.sessionID,
      }),
    );
    return pending.task;
  }

  /** 执行终止：等待旧操作收尾，分级清理资源，提交最终状态。 */
  private async performTermination(id: string): Promise<void> {
    const pending = this.termination;
    if (!pending || pending.id !== id) {
      return;
    }

    for (;;) {
      const waiters = pending.waitForOperations;
      pending.waitForOperations = [];
      for (const waiter of waiters) {
        await waiter();
      }

      const requestedTarget = pending.target;
      const result = await this.cleanup(
        requestedTarget,
        this.state.taskID ?? "",
      );
      if (result.sessionID) {
        pending.sessionID = result.sessionID;
      }

      if (pending.target !== requestedTarget || pending.waitForOperations.length > 0) {
        continue;
      }

      const connectionState =
        requestedTarget === RealtimeTerminationScope.all
          ? RealtimeConnectionState.idle
          : result.hasLocalMedia
            ? RealtimeConnectionState.ready
            : RealtimeConnectionState.idle;
      const finalState = new RealtimeState({
        connectionState,
        sessionID: pending.sessionID ?? this.state.sessionID,
        reason: pending.reason,
      });
      // 先完成内部收尾，再通知监听器，避免旧任务覆盖重入的关闭请求。
      const active = this.activeOperation;
      if (active && scopeAffects(requestedTarget, active.kind)) {
        this.finish(active);
      }
      const listener = !this.state.equals(finalState)
        ? this.stateListener
        : undefined;
      this.state = finalState;
      this.termination = undefined;
      this.errorHandler.invalidatePendingFailures(requestedTarget);
      if (listener) {
        listener(finalState);
      }
      if (pending.error) {
        await this.errorHandler.report(pending.error);
      }
      return;
    }
  }

  /** 结束指定操作，释放操作准入场。 */
  private finish(operation: Operation): void {
    if (this.activeOperation?.id === operation.id) {
      this.activeOperation = undefined;
    }
  }

  /** 提交新状态并通知监听器；状态未变化时不通知。 */
  private async setState(nextState: RealtimeState): Promise<void> {
    if (this.state.equals(nextState)) {
      return;
    }
    this.state = nextState;
    this.stateListener?.(nextState);
  }

  /** 构造统一的操作取消错误。 */
  static cancelledError(): XmaxError {
    return new XmaxError(
      XmaxErrorCode.cancelled,
      "Realtime operation was cancelled",
    );
  }
}
