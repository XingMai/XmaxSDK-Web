import { FrameInterpolationManager, type FrameInterpolationProcessing } from "../../Foundation/Media/Video/FrameInterpolationManager";
import type { ModelSize } from "../../Service/Realtime/RealtimeModel";

export interface RemoteFrameInterpolationOptions {
  size: ModelSize;
  targetFrameRate: number;
  onActiveChange?: (active: boolean) => void;
  onFailure: (error: unknown) => void;
}

type ProcessorFactory = typeof FrameInterpolationManager.create;

interface QueuedFrame {
  slot: number;
  time: number;
}

/**
 * 远端帧显示管线：帧按时间戳排队，显示时钟按 vsync 推进。
 *
 * 输入仍来自 video 元素的帧回调，但接管后画面始终由 canvas 输出，
 * 不再切回 video，因此不会显示比当前更旧的内容。输出整体延迟一个
 * 源帧间隔，为中间帧留出计算窗口；迟到的中间帧直接丢弃不补播。
 */
export class RemoteVideoFramePipeline {
  private processor?: FrameInterpolationProcessing;
  private readonly abort = new AbortController();
  private callback?: number;
  private raf?: number;
  private stallTimer?: ReturnType<typeof setTimeout>;
  private initializationTimer?: ReturnType<typeof setTimeout>;
  private loading = false;
  private busy = false;
  private stopped = false;
  private generation = 0;
  /** 播放时钟锚点：最近一次输入帧的媒体时间与对应的 vsync 时刻。 */
  private anchor?: { media: number; at: number };
  /** 输出延迟，取最近一次有效源帧间隔，为中间帧留出计算窗口。 */
  private delay = 0;
  private queue: QueuedFrame[] = [];
  private displayedTime?: number;
  private previousTime?: number;
  private previousSlot?: number;
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
    this.callback = this.video.requestVideoFrameCallback((now, metadata) => {
      this.callback = undefined;
      if (this.stopped) return;
      try { this.frame(now, metadata); } catch (error) { this.fail(error); }
      this.observe();
    });
  }

  private frame(now: number, metadata: VideoFrameCallbackMetadata): void {
    if (typeof document !== "undefined" && document.hidden) {
      this.resetTimeline();
      return;
    }
    if (metadata.width !== this.options.size.width || metadata.height !== this.options.size.height) {
      // 回传尺寸变更在生效前继续显示原视频，不能跨尺寸做插值。
      this.resetTimeline();
      return;
    }
    if (!this.processor) {
      if (!this.loading) void this.initialize();
      return;
    }
    const time = metadata.mediaTime * 1000;
    // 重复或倒序的输入不进入时间线；换流会创建新的管线。
    if (!Number.isFinite(time) || (this.previousTime !== undefined && time <= this.previousTime)) return;
    const previous = this.previousTime;
    const interval = previous === undefined ? 0 : time - previous;
    const consecutive = this.previousPresented === undefined || metadata.presentedFrames === this.previousPresented + 1;
    const previousSlot = this.previousSlot;
    this.anchor = { media: time, at: now };
    this.previousTime = time;
    this.previousPresented = metadata.presentedFrames;
    const slot = this.processor.capture(this.video);
    this.previousSlot = slot;
    if (previous === undefined || interval > 250) {
      // 首帧与断流恢复直接显示当前帧；旧队列内容都已过期。
      this.queue = [];
      this.delay = 0;
      this.present({ slot, time });
      this.startTick();
      return;
    }
    this.delay = interval;
    this.enqueue({ slot, time });
    this.startTick();
    // 跳帧或间隔超出输出预算时只显示原帧，不做插值。
    if (!consecutive || interval < 2000 / this.options.targetFrameRate - 1 || previousSlot === undefined || this.busy) return;
    this.interpolate(previousSlot, slot, previous, time, interval);
  }

  /** 帧按显示时间升序入队；同一时间的内容后到先出。 */
  private enqueue(frame: QueuedFrame): void {
    const index = this.queue.findIndex((queued) => queued.time >= frame.time);
    if (index < 0) this.queue.push(frame);
    else this.queue.splice(index, 0, frame);
  }

  private interpolate(previousSlot: number, currentSlot: number,
    previousTime: number, currentTime: number, interval: number): void {
    const generation = this.generation;
    const midpoint = (previousTime + currentTime) / 2;
    const startedAt = performance.now();
    this.busy = true;
    this.stallTimer = setTimeout(() => {
      if (this.busy) this.fail(new Error("Interpolation GPU submission timed out"));
    }, Math.max(100, interval * 3));
    void this.processor!.interpolate(previousSlot, currentSlot).then((slot) => {
      if (this.stopped) return;
      this.busy = false;
      clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
      if (generation !== this.generation) return;
      const elapsed = performance.now() - startedAt;
      this.slowPairs = elapsed > interval / 2 ? this.slowPairs + 1 : 0;
      if (this.slowPairs >= 5) {
        this.fail(new Error("Interpolation exceeded the GPU frame budget for 5 consecutive pairs"));
        return;
      }
      // 显示时钟已越过中点的中间帧直接丢弃，不补播。
      if (this.position(performance.now()) >= midpoint) return;
      this.enqueue({ slot, time: midpoint });
    }).catch((error) => { if (!this.stopped) this.fail(error); });
  }

  /** 显示时钟位置：锚点媒体时间随墙钟推进，整体后移一个源帧间隔。 */
  private position(now: number): number {
    if (!this.anchor) return -Infinity;
    return this.anchor.media + (now - this.anchor.at) - this.delay;
  }

  /** vsync 显示节拍：弹出到点的帧并显示最新的一张。 */
  private readonly tick = (now: number): void => {
    if (this.stopped) return;
    this.raf = requestAnimationFrame(this.tick);
    const position = this.position(now);
    let frame: QueuedFrame | undefined;
    while (this.queue.length > 0 && this.queue[0]!.time <= position) {
      frame = this.queue.shift();
    }
    if (frame) this.present(frame);
  };

  private startTick(): void {
    if (this.raf === undefined) this.raf = requestAnimationFrame(this.tick);
  }

  private present(frame: QueuedFrame): void {
    // 环形槽位会复用，按时间戳去重而不是按槽位。
    if (this.displayedTime === frame.time) return;
    this.processor!.present(frame.slot);
    this.displayedTime = frame.time;
    this.canvas.style.visibility = "visible";
    this.setActive(true);
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

  private resetTimeline(): void {
    this.generation++;
    this.queue = [];
    clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.raf = undefined;
    this.anchor = undefined;
    this.delay = 0;
    this.displayedTime = undefined;
    this.previousTime = undefined;
    this.previousSlot = undefined;
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
    this.resetTimeline();
    this.processor?.destroy();
    this.processor = undefined;
  }
}
