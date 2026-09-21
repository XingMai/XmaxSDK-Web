import type {
  RealtimeLaunchTiming,
  RealtimeLaunchTimingListener,
} from "../../Service/Realtime/RealtimeLaunchTiming";

/** @internal 只观察首轮启动，不参与生成流程的状态提交或等待。 */
export class RealtimeLaunchTimer {
  private snapshot: RealtimeLaunchTiming = Object.freeze({});
  private listener?: RealtimeLaunchTimingListener;
  private sequence = 0;
  private active = false;
  private startedAt = 0;

  setListener(listener?: RealtimeLaunchTimingListener): void {
    this.listener = listener;
    this.notify();
  }

  startCamera(): () => void {
    this.sequence += 1;
    this.active = true;
    this.startedAt = performance.now();
    this.snapshot = Object.freeze({});
    const complete = this.measure("cameraMs", this.startedAt);
    this.notify();
    return complete;
  }

  startConnection(): () => void {
    return this.measure("connectionMs", performance.now());
  }

  startFirstFrame(): () => void {
    return this.measure("firstFrameMs", performance.now());
  }

  /** 冻结本轮结果，令尚未完成的回调失效；下一轮相机启动才重置。 */
  cancel(): void {
    this.active = false;
    this.sequence += 1;
  }

  private measure(
    key: "cameraMs" | "connectionMs" | "firstFrameMs",
    startedAt: number,
  ): () => void {
    const sequence = this.sequence;
    return () => {
      if (!this.active || sequence !== this.sequence || this.snapshot[key] !== undefined) {
        return;
      }
      const now = performance.now();
      this.snapshot = Object.freeze({
        ...this.snapshot,
        [key]: now - startedAt,
        ...(key === "firstFrameMs" ? { totalMs: now - this.startedAt } : {}),
      });
      this.notify();
    };
  }

  private notify(): void {
    try {
      // 异步监听器也允许使用；观察者异常不得影响媒体生命周期。
      void Promise.resolve(this.listener?.(this.snapshot)).catch(() => {});
    } catch {
      // 同步观察者异常同样隔离。
    }
  }
}
