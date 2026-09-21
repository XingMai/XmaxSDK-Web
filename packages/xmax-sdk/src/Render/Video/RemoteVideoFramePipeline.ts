import { FrameInterpolationManager, type FrameInterpolationProcessing } from "../../Foundation/Media/Video/FrameInterpolationManager";
import type { ModelSize } from "../../Service/Realtime/RealtimeModel";

export interface RemoteFrameInterpolationOptions {
  size: ModelSize;
  targetFrameRate: number;
  onActiveChange?: (active: boolean) => void;
  onFailure: (error: unknown) => void;
}

type ProcessorFactory = typeof FrameInterpolationManager.create;

/** 接管后原帧/插帧共用画布和单调时间线；忙时丢输入，迟到插帧不补播。 */
export class RemoteVideoFramePipeline {
  private processor?: FrameInterpolationProcessing;
  private readonly abort = new AbortController();
  private callback?: number;
  private readonly presentationTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly animations = new Set<number>();
  private gpuTimer?: ReturnType<typeof setTimeout>;
  private initializationTimer?: ReturnType<typeof setTimeout>;
  private loading = false;
  private busy = false;
  private stopped = false;
  private pair = 0;
  private previousTime?: number;
  private previousPresented?: number;
  private displayedTime?: number;
  private slowPairs = 0;
  private active = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly options: RemoteFrameInterpolationOptions,
    private readonly createProcessor: (
      ...args: Parameters<ProcessorFactory>
    ) => Promise<FrameInterpolationProcessing> = FrameInterpolationManager.create,
  ) {}

  start(): void {
    if (this.stopped || this.callback !== undefined) return;
    if (typeof this.video.requestVideoFrameCallback !== "function") {
      this.fail(new Error("Video frame callbacks are unavailable"));
      return;
    }
    this.observe();
  }

  private observe(): void {
    if (this.stopped) return;
    this.callback = this.video.requestVideoFrameCallback((_now, metadata) => {
      this.callback = undefined;
      if (this.stopped) return;
      try { this.frame(metadata); } catch (error) { this.fail(error); }
      this.observe();
    });
  }

  private frame(metadata: VideoFrameCallbackMetadata): void {
    if (typeof document !== "undefined" && document.hidden) {
      this.resetPair();
      return;
    }
    if (metadata.width !== this.options.size.width || metadata.height !== this.options.size.height) {
      // 回传尺寸变更在生效前继续显示原视频，不能跨尺寸做插值。
      this.resetPair();
      return;
    }
    if (!this.processor) {
      if (!this.loading) void this.initialize();
      return;
    }
    const time = metadata.mediaTime;
    // 不把重复或倒序输入放进两帧纹理缓存；换流会创建新的管线/时间线。
    if (!Number.isFinite(time) || (this.previousTime !== undefined && time <= this.previousTime)) return;
    if (this.busy) {
      // 输入已前进，旧中间帧失效。保持画布所有权，至多显示已捕获的端点原帧。
      // 不覆盖仍被 GPU 使用的输入纹理，也不取消独立的 GPU 超时保护。
      this.pair++;
      this.clearPresentation();
      if (this.previousTime !== undefined) this.present(this.previousTime, () => this.processor!.presentCurrent());
      return;
    }
    const previous = this.previousTime;
    const interval = previous === undefined ? 0 : (time - previous) * 1000;
    const consecutive = this.previousPresented === undefined || metadata.presentedFrames === this.previousPresented + 1;
    this.clearPresentation();
    const pair = ++this.pair;
    this.processor.capture(this.video);
    this.previousTime = time;
    this.previousPresented = metadata.presentedFrames;
    // 首次接管/恢复直接接当前原帧，不从原视频已经走过的位置倒放上一帧。
    // 跳帧或预算不足只跳过插值，不能露出底层更靠前的原视频。
    if (previous === undefined || !consecutive || interval > 250 || interval < 2000 / this.options.targetFrameRate - 1) {
      this.present(time, () => this.processor!.presentCurrent());
      return;
    }
    const startedAt = performance.now();
    const anchor = Number.isFinite(metadata.expectedDisplayTime) ? metadata.expectedDisplayTime : startedAt;
    const currentDue = anchor + interval;
    if (currentDue <= startedAt) {
      this.present(time, () => this.processor!.presentCurrent());
      return;
    }
    this.present(previous, () => this.processor!.presentPrevious());
    // 即使后续断流，也要推进到最后一张原帧，而不是停在旧中间帧或切回 video。
    this.schedule(currentDue, Infinity, pair, () => this.present(time, () => this.processor!.presentCurrent()));
    this.busy = true;
    this.gpuTimer = setTimeout(() => this.fail(new Error("Interpolation GPU submission timed out")), Math.max(100, interval * 3));
    void this.processor.interpolate().then(() => {
      if (this.stopped) return;
      this.busy = false;
      clearTimeout(this.gpuTimer);
      this.gpuTimer = undefined;
      const elapsed = performance.now() - startedAt;
      this.slowPairs = elapsed > interval / 2 ? this.slowPairs + 1 : 0;
      if (this.slowPairs >= 5) {
        this.fail(new Error("Interpolation exceeded the GPU frame budget for 5 consecutive pairs"));
        return;
      }
      if (pair !== this.pair || performance.now() >= currentDue) return;
      this.schedule(anchor + interval / 2, currentDue, pair,
        () => this.present((previous + time) / 2, () => this.processor!.presentInterpolated()));
    }).catch((error) => { if (!this.stopped) this.fail(error); });
  }

  /** 所有显示入口共用时间戳门禁，不能显示已越过的原帧或中间帧。 */
  private present(time: number, draw: () => void): void {
    if (this.displayedTime !== undefined && time <= this.displayedTime) return;
    draw();
    this.displayedTime = time;
    this.canvas.style.visibility = "visible";
    this.setActive(true);
  }

  private schedule(at: number, deadline: number, pair: number, draw: () => void): void {
    const timer = setTimeout(() => {
      this.presentationTimers.delete(timer);
      if (this.stopped || pair !== this.pair || performance.now() >= deadline) return;
      const animation = requestAnimationFrame(() => {
        this.animations.delete(animation);
        if (this.stopped || pair !== this.pair || performance.now() >= deadline) return;
        try { draw(); } catch (error) { this.fail(error); }
      });
      this.animations.add(animation);
    }, Math.max(0, at - performance.now()));
    this.presentationTimers.add(timer);
  }

  private async initialize(): Promise<void> {
    this.loading = true;
    this.initializationTimer = setTimeout(() => this.fail(new Error("Interpolation initialization timed out")), 15_000);
    try {
      const processor = await this.createProcessor(this.canvas, this.options.size,
        (error) => this.fail(error), this.abort.signal);
      if (this.stopped) {
        processor.destroy();
        return;
      }
      this.processor = processor;
    } catch (error) {
      if (!this.stopped) this.fail(error);
    } finally {
      clearTimeout(this.initializationTimer);
      this.initializationTimer = undefined;
      this.loading = false;
    }
  }

  private setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.options.onActiveChange?.(active);
  }

  private clearPresentation(): void {
    this.presentationTimers.forEach((timer) => clearTimeout(timer));
    this.presentationTimers.clear();
    this.animations.forEach((animation) => cancelAnimationFrame(animation));
    this.animations.clear();
  }

  private resetPair(): void {
    this.pair++;
    this.clearPresentation();
    this.previousTime = undefined;
    this.previousPresented = undefined;
    this.displayedTime = undefined;
    this.canvas.style.visibility = "hidden";
    this.setActive(false);
  }

  private fail(error: unknown): void {
    if (this.stopped) return;
    this.stop();
    this.options.onFailure(error);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    if (this.callback !== undefined) this.video.cancelVideoFrameCallback(this.callback);
    this.callback = undefined;
    clearTimeout(this.initializationTimer);
    clearTimeout(this.gpuTimer);
    this.resetPair();
    this.processor?.destroy();
    this.processor = undefined;
  }
}
