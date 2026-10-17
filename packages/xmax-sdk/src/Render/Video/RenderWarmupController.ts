/**
 * 首帧后保持视频播放，等待预热结束再渐入；不缓存或改写媒体帧。
 */
export class RenderWarmupController {
  /**
   * 预热配置与生命周期
   */
  private durationMs?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private completed = false;

  /**
   * 创建视图预热控制器。
   */
  constructor(private readonly element: HTMLElement) {}

  /**
   * 是否仍在等待首帧或预热完成；期间不允许对不可见画面交互。
   */
  get isPending(): boolean {
    return this.durationMs !== undefined && !this.completed;
  }

  /**
   * 为新媒体隐藏画面；undefined 表示直接显示，不启用预热。
   */
  prepare(durationMs?: number): void {
    this.reset();
    this.durationMs = durationMs;
    if (durationMs === undefined) {
      return;
    }

    this.element.style.transition = "none";
    this.element.style.opacity = "0";
    this.element.style.pointerEvents = "none";
  }

  /**
   * 首帧就绪后开始一次性预热，结束时通知并渐入画面。
   */
  start(onCompleted: () => void): void {
    if (this.durationMs === undefined || this.started) {
      return;
    }

    this.started = true;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.completed = true;
      const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      this.element.style.transition = reduceMotion ? "none" : "opacity 300ms ease-in-out";
      this.element.style.opacity = "1";
      this.element.style.pointerEvents = "";
      onCompleted();
    }, this.durationMs);
  }

  /**
   * 换流或卸载时取消预热和渐入，防止旧任务显示新画面。
   */
  reset(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.started = false;
    this.completed = false;
    if (this.durationMs !== undefined) {
      this.element.style.transition = "";
      this.element.style.opacity = "";
      this.element.style.pointerEvents = "";
    }
    this.durationMs = undefined;
  }
}
