import { FrameInterpolationManager, type FrameInterpolationProcessing } from "../../Foundation/Media/Video/FrameInterpolationManager";
import type { ModelSize } from "../../Service/Realtime/RealtimeModel";

export interface RemoteFrameInterpolationOptions {
  size: ModelSize;
  targetFrameRate: number;
  onActiveChange?: (active: boolean) => void;
  onFailure: (error: unknown) => void;
}

type ProcessorFactory = typeof FrameInterpolationManager.create;

/** 有界的两帧显示队列。忙时丢弃输入；迟到帧不补播，断流及时退回 video。 */
export class RemoteVideoFramePipeline {
  private processor?: FrameInterpolationProcessing;
  private readonly abort = new AbortController();
  private callback?: number;
  private midpointTimer?: ReturnType<typeof setTimeout>;
  private stallTimer?: ReturnType<typeof setTimeout>;
  private initializationTimer?: ReturnType<typeof setTimeout>;
  private animation?: number;
  private loading = false;
  private busy = false;
  private stopped = false;
  private pair = 0;
  private previousTime?: number;
  private previousPresented?: number;
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
    if (this.busy) return;
    const interval = this.previousTime === undefined ? 0 : (metadata.mediaTime - this.previousTime) * 1000;
    const consecutive = this.previousPresented === undefined || metadata.presentedFrames === this.previousPresented + 1;
    this.clearPresentation();
    const pair = ++this.pair;
    this.processor.capture(this.video);
    this.previousTime = metadata.mediaTime;
    this.previousPresented = metadata.presentedFrames;
    // 不对时间倒退、跳帧、长停顿或超出输出预算的输入做插值。
    if (!consecutive || interval <= 0 || interval > 250 || interval < 2000 / this.options.targetFrameRate - 1) {
      this.setActive(false);
      this.canvas.style.visibility = "hidden";
      return;
    }
    const startedAt = performance.now();
    this.processor.presentPrevious();
    this.canvas.style.visibility = "visible";
    this.busy = true;
    this.stallTimer = setTimeout(() => {
      if (this.busy) this.fail(new Error("Interpolation GPU submission timed out"));
      else this.resetPair();
    }, Math.max(100, interval * 3));
    void this.processor.interpolate().then(() => {
      if (this.stopped) return;
      this.busy = false;
      if (pair !== this.pair) return;
      const elapsed = performance.now() - startedAt;
      this.slowPairs = elapsed > interval / 2 ? this.slowPairs + 1 : 0;
      if (this.slowPairs >= 5) {
        this.fail(new Error("Interpolation exceeded the GPU frame budget for 5 consecutive pairs"));
        return;
      }
      if (elapsed >= interval) return;
      this.midpointTimer = setTimeout(() => {
        this.animation = requestAnimationFrame(() => {
          this.animation = undefined;
          if (this.stopped || pair !== this.pair || performance.now() - startedAt >= interval) return;
          try {
            this.processor!.presentInterpolated();
            this.setActive(true);
          } catch (error) { this.fail(error); }
        });
      }, Math.max(0, interval / 2 - elapsed));
    }).catch((error) => { if (!this.stopped) this.fail(error); });
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
    clearTimeout(this.midpointTimer);
    clearTimeout(this.stallTimer);
    if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    this.animation = undefined;
  }

  private resetPair(): void {
    this.pair++;
    this.clearPresentation();
    this.previousTime = undefined;
    this.previousPresented = undefined;
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
    this.resetPair();
    this.processor?.destroy();
    this.processor = undefined;
  }
}
