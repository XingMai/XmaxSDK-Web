import { FrameInterpolationManager, type FrameInterpolationProcessing } from "../../Foundation/Media/Video/FrameInterpolationManager";
import type { ModelSize } from "../../Service/Realtime/RealtimeModel";

export interface RemoteFrameInterpolationOptions {
  size: ModelSize;
  targetFrameRate: number;
  onActiveChange?: (active: boolean) => void;
  onFailure: (error: unknown) => void;
}

type ProcessorFactory = typeof FrameInterpolationManager.create;

interface InputFrame {
  slot: number;
  time: number;
}

interface QueuedFrame {
  slot: number;
  start: number;
  end: number;
}

/**
 * 远端帧显示管线：输出帧带显示窗口排队，显示时钟按 vsync 推进。
 *
 * 输入仍来自 video 元素的帧回调，但接管后画面始终由 canvas 输出，
 * 不再切回 video。每对连续帧产出一个中间帧，与原帧各占半个源帧
 * 间隔依次显示；插值耗时只让输出整体顺延，不丢弃中间帧，显示
 * 节奏保持匀速。断流或时间线不连续时从最新帧重新接管。
 */
export class RemoteVideoFramePipeline {
  private processor?: FrameInterpolationProcessing;
  private readonly abort = new AbortController();
  private callback?: number;
  private raf?: number;
  private stallTimer?: ReturnType<typeof setTimeout>;
  private initializationTimer?: ReturnType<typeof setTimeout>;
  private loading = false;
  private stopped = false;
  private generation = 0;
  /** 未处理的最新输入帧；处理期间到达的输入只保留最新一帧。 */
  private latest?: InputFrame;
  private draining = false;
  private last?: InputFrame;
  /** 输出时间线末端（performance 时间轴）；排期永不早于当前时刻。 */
  private nextPresentation = 0;
  private queue: QueuedFrame[] = [];
  private displayed?: QueuedFrame;
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
    if (!Number.isFinite(time) || (this.last !== undefined && time <= this.last.time)) return;
    this.latest = { slot: this.processor.capture(this.video), time };
    if (!this.draining) void this.drain();
  }

  /** 串行处理输入帧：中间帧与原帧算好后一起排期，不在中途切换画面。 */
  private async drain(): Promise<void> {
    if (this.stopped) return;
    this.draining = true;
    try {
      while (this.latest && !this.stopped) {
        const input = this.latest;
        this.latest = undefined;
        const last = this.last;
        this.last = input;
        const interval = last === undefined ? 0 : input.time - last.time;
        if (last === undefined || interval > 250) {
          // 首帧与断流恢复直接显示当前帧；旧队列内容都已过期。
          this.queue = [];
          this.present({ slot: input.slot, start: 0, end: 0 });
          this.nextPresentation = performance.now();
          this.startTick();
          continue;
        }
        if (interval < 2000 / this.options.targetFrameRate - 1) {
          // 间隔已经超出输出预算时只做透传，原帧独占整个间隔。
          this.schedule([{ slot: input.slot, interval }]);
          continue;
        }
        const midpointSlot = await this.interpolate(last.slot, input.slot, interval);
        if (midpointSlot === undefined || this.stopped) return;
        // 中间帧与原帧各占半个间隔依次显示；插值耗时只顺延，不丢帧。
        this.schedule([
          { slot: midpointSlot, interval: interval / 2 },
          { slot: input.slot, interval: interval - interval / 2 },
        ]);
      }
    } finally {
      this.draining = false;
    }
  }

  /** 等待中间帧完成；GPU 超时、失败或时间线已重置时返回 undefined。 */
  private async interpolate(previous: number, current: number, interval: number): Promise<number | undefined> {
    const generation = this.generation;
    const startedAt = performance.now();
    this.stallTimer = setTimeout(() => this.fail(new Error("Interpolation GPU submission timed out")), Math.max(100, interval * 3));
    try {
      const slot = await this.processor!.interpolate(previous, current);
      if (this.stopped || generation !== this.generation) return undefined;
      // 连续多对超过一个完整源帧间隔才降级；偶发慢帧只顺延输出。
      this.slowPairs = performance.now() - startedAt > interval ? this.slowPairs + 1 : 0;
      if (this.slowPairs >= 5) {
        this.fail(new Error("Interpolation exceeded the GPU frame budget for 5 consecutive pairs"));
        return undefined;
      }
      return slot;
    } catch (error) {
      if (!this.stopped) this.fail(error);
      return undefined;
    } finally {
      clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
    }
  }

  /** 帧窗口从时间线末端依次排开；显示已排干时从当前时刻重新开始。 */
  private schedule(frames: { slot: number; interval: number }[]): void {
    let start = Math.max(this.nextPresentation, performance.now());
    for (const frame of frames) {
      this.enqueue({ slot: frame.slot, start, end: start + frame.interval });
      start += frame.interval;
    }
    this.nextPresentation = start;
    this.startTick();
  }

  private enqueue(frame: QueuedFrame): void {
    const index = this.queue.findIndex((queued) => queued.start >= frame.start);
    if (index < 0) this.queue.push(frame);
    else this.queue.splice(index, 0, frame);
  }

  /** vsync 显示节拍：显示窗口覆盖当前时刻的帧，过期帧直接清出队列。 */
  private readonly tick = (now: number): void => {
    if (this.stopped) return;
    this.raf = requestAnimationFrame(this.tick);
    while (this.queue.length > 0 && this.queue[0]!.end <= now) this.queue.shift();
    const frame = this.queue[0];
    if (frame && frame.start <= now) this.present(frame);
  };

  private startTick(): void {
    if (this.raf === undefined) this.raf = requestAnimationFrame(this.tick);
  }

  private present(frame: QueuedFrame): void {
    if (this.displayed === frame) return;
    this.processor!.present(frame.slot);
    this.displayed = frame;
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
    this.latest = undefined;
    this.last = undefined;
    this.queue = [];
    this.displayed = undefined;
    this.nextPresentation = 0;
    clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.raf = undefined;
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
