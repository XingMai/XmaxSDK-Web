import type {
  RealtimeLaunchTiming,
  RealtimeLaunchTimingListener,
} from "../../Service/Realtime/RealtimeLaunchTiming";

/**
 * @internal 只观察首轮启动，不参与生成流程的状态提交或等待。
 */
export class RealtimeLaunchTimer {
  /**
   * 统计快照与观察者
   */
  private snapshot: RealtimeLaunchTiming = Object.freeze({});
  private listener?: RealtimeLaunchTimingListener;

  /**
   * 当前启动周期与计时起点
   */
  private sequence = 0;
  private active = false;
  private startedAt = 0;

  /**
   * 设置统计监听器并立即回放当前快照；传 undefined 取消监听。
   */
  setListener(listener?: RealtimeLaunchTimingListener): void {
    this.listener = listener;
    this.notify();
  }

  /**
   * 开始新的启动周期并清空旧快照，返回记录相机创建完成的一次性回调。
   */
  startCamera(): () => void {
    this.sequence += 1;
    this.active = true;
    this.startedAt = performance.now();
    this.snapshot = Object.freeze({});

    const complete = this.measure("cameraMs", this.startedAt);
    this.notify();

    return complete;
  }

  /**
   * 开始等待用户授权系统媒体权限，返回授权决定时调用的记录函数。
   * 仅在系统弹出授权请求时使用；已授权或未弹窗不记录该阶段。
   */
  startPermission(): () => void {
    return this.measure("permissionMs", performance.now());
  }

  /**
   * 开始会话与进房计时，返回连接阶段完成时调用的记录函数。
   * 相机预热等待计入连接耗时。
   */
  startConnection(): () => void {
    return this.measure("connectionMs", performance.now());
  }

  /**
   * 开始发布本地流计时，返回发布完成时调用的记录函数。
   */
  startPublish(): () => void {
    return this.measure("publishMs", performance.now());
  }

  /**
   * 开始等待远端显示首帧；完成回调同时记录首帧耗时和实际总耗时。
   */
  startFirstFrame(): () => void {
    return this.measure("firstFrameMs", performance.now());
  }

  /**
   * 冻结本轮结果，令尚未完成的回调失效；下一轮相机启动才重置。
   */
  cancel(): void {
    this.active = false;
    this.sequence += 1;
  }

  /**
   * 创建当前周期的一次性计时回调；周期失效或该阶段已记录时忽略调用。
   */
  private measure(
    key: "cameraMs" | "permissionMs" | "connectionMs" | "publishMs" | "firstFrameMs",
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

  /**
   * 分发不可变快照；隔离同步和异步观察者异常，避免影响媒体生命周期。
   */
  private notify(): void {
    try {
      // 异步监听器也允许使用；观察者异常不得影响媒体生命周期。
      void Promise.resolve(this.listener?.(this.snapshot)).catch(() => {});
    } catch {
      // 同步观察者异常同样隔离。
    }
  }
}
