import { FrameInterpolationManager, type FrameInterpolationProcessing } from "../../Foundation/Media/Video/FrameInterpolationManager";
import type { ModelSize } from "../../Service/Realtime/RealtimeModel";
import { XmaxLogger, XmaxLoggerOption } from "../../Foundation/Logging/XmaxLogger";

/**
 * 插帧输出按 60 fps 预算处理，每对源帧最多插入一帧。
 */
const INTERPOLATION_FRAME_RATE = 60;

export interface RemoteFrameInterpolationOptions {
  size: ModelSize;
  onActiveChange?: (active: boolean) => void;
  /**
   * 实际提交画布呈现时通知，参数表示是否为插值帧。
   */
  onFramePresented?: (interpolated: boolean) => void;
  onFailure: (error: unknown) => void;
}

type ProcessorFactory = typeof FrameInterpolationManager.create;

interface QueuedFrame {
  slot: number;
  time: number;
  interpolated?: boolean;
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

  /**
   * 帧时间基准：媒体时间异常后，本管线持续使用回调时钟，避免反复切换。
   */
  private timeSource: "mediaTime" | "callback" = "mediaTime";

  /**
   * 低频诊断：只记录计数和状态，不参与播放、插值或降级决策。
   */
  private diagnosticTimer?: ReturnType<typeof setInterval>;
  private diagnosticStartedAt = 0;
  private lastCallbackAt?: number;
  private lastInput?: { width: number; height: number; mediaTime: number; presentedFrames: number };
  private gpuStartedAt?: number;
  private lastGpuDuration?: number;
  private readonly diagnosticCounts = {
    callbacks: 0, hidden: 0, sizeMismatch: 0, invalidTimestamp: 0, duplicateFrames: 0,
    captured: 0, gpuStarted: 0, gpuCompleted: 0, lateMidpoints: 0,
    ticks: 0, presentSubmitted: 0,
  };

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
    this.startDiagnostics();
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
    this.diagnosticCounts.callbacks++;
    this.lastCallbackAt = performance.now();
    this.lastInput = {
      width: metadata.width, height: metadata.height,
      mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames,
    };

    if (typeof document !== "undefined" && document.hidden) {
      this.diagnosticCounts.hidden++;
      this.resetTimeline();
      return;
    }
    if (metadata.width !== this.options.size.width || metadata.height !== this.options.size.height) {
      this.diagnosticCounts.sizeMismatch++;
      // 回传尺寸变更在生效前继续显示原视频，不能跨尺寸做插值。
      this.resetTimeline();
      return;
    }
    if (!this.processor) {
      if (!this.loading) void this.initialize();
      return;
    }
    const time = this.resolveFrameTime(now, metadata);
    if (time === undefined) return;

    const previous = this.previousTime;
    const interval = previous === undefined ? 0 : time - previous;
    const consecutive = this.previousPresented === undefined || metadata.presentedFrames === this.previousPresented + 1;
    const previousSlot = this.previousSlot;
    this.anchor = { media: time, at: now };
    this.previousTime = time;
    this.previousPresented = metadata.presentedFrames;
    const slot = this.processor.capture(this.video);
    this.diagnosticCounts.captured++;
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
    if (!consecutive || interval < 2000 / INTERPOLATION_FRAME_RATE - 1 || previousSlot === undefined || this.busy) {
      return;
    }
    this.interpolate(previousSlot, slot, previous, time, interval);
  }

  /**
   * 优先使用媒体时间；新帧的媒体时间异常时切换到单调回调时钟。
   */
  private resolveFrameTime(now: number, metadata: VideoFrameCallbackMetadata): number | undefined {
    // 帧序号没有前进时仍然丢弃，不能将同一帧当作时间戳兼容问题。
    if (this.previousPresented !== undefined && metadata.presentedFrames <= this.previousPresented) {
      this.diagnosticCounts.duplicateFrames++;
      return undefined;
    }

    let time = this.timeSource === "mediaTime" ? metadata.mediaTime * 1000 : now;
    if (!Number.isFinite(time) || (this.previousTime !== undefined && time <= this.previousTime)) {
      this.diagnosticCounts.invalidTimestamp++;
      if (this.timeSource === "callback" || !Number.isFinite(now)) return undefined;

      // 切换时清空旧时间基准的原帧、中间帧及显示锚点，迟到的 GPU 结果按版本丢弃。
      this.timeSource = "callback";
      this.resetTimeline(true);
      this.logDiagnostics("clock-fallback");
      time = now;
    }

    return time;
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
    this.gpuStartedAt = startedAt;
    this.diagnosticCounts.gpuStarted++;
    this.busy = true;
    this.stallTimer = setTimeout(() => {
      if (this.busy) this.fail(new Error("Interpolation GPU submission timed out"));
    }, Math.max(100, interval * 3));
    void this.processor!.interpolate(previousSlot, currentSlot).then((slot) => {
      if (this.stopped) return;
      this.diagnosticCounts.gpuCompleted++;
      this.lastGpuDuration = performance.now() - startedAt;
      this.gpuStartedAt = undefined;
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
      if (this.position(performance.now()) >= midpoint) {
        this.diagnosticCounts.lateMidpoints++;
        return;
      }
      this.enqueue({ slot, time: midpoint, interpolated: true });
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
    this.diagnosticCounts.ticks++;
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
    this.diagnosticCounts.presentSubmitted++;
    this.displayedTime = frame.time;
    this.canvas.style.visibility = "visible";
    this.setActive(true);
    this.options.onFramePresented?.(frame.interpolated ?? false);
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
      if (this.processor && !this.stopped) this.logDiagnostics("ready");
    }
  }

  private setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.options.onActiveChange?.(active);
  }

  private resetTimeline(preserveGpuTimeout = false): void {
    this.generation++;
    this.queue = [];
    // 仅切换时间基准时保留在途 GPU 的原有超时，不改变计算保护行为。
    if (!preserveGpuTimeout) {
      clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
    }
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
    this.logDiagnostics("failed", error);
    this.stop();
    this.options.onFailure(error);
  }

  stop(): void {
    if (this.stopped) return;
    this.logDiagnostics("stopped");
    clearInterval(this.diagnosticTimer);
    this.diagnosticTimer = undefined;
    this.stopped = true;
    this.abort.abort();
    if (this.callback !== undefined) this.video.cancelVideoFrameCallback(this.callback);
    this.callback = undefined;
    clearTimeout(this.initializationTimer);
    this.resetTimeline();
    this.processor?.destroy();
    this.processor = undefined;
  }

  /**
   * 用独立定时器观察帧回调停止的情况；日志关闭时不启动定时器。
   */
  private startDiagnostics(): void {
    this.diagnosticStartedAt = performance.now();
    if (!XmaxLogger.isEnabled(XmaxLoggerOption.business) || this.diagnosticTimer !== undefined) return;

    this.logDiagnostics("started");
    this.diagnosticTimer = setInterval(() => this.logDiagnostics("sample"), 2_000);
  }

  /**
   * 输出累计计数及最近状态；呈现计数仅表示提交成功，不代表 GPU 已实际显示。
   */
  private logDiagnostics(event: string, error?: unknown): void {
    XmaxLogger.render.info(() => {
      const now = performance.now();
      const age = (at?: number) => at === undefined ? "n/a" : `${Math.round(now - at)} ms`;
      const input = this.lastInput;
      const counts = this.diagnosticCounts;
      return `插帧诊断 (Frame Interpolation Diagnostics)\n` +
        `├─ event: ${event}, elapsed: ${age(this.diagnosticStartedAt)}, loading: ${this.loading}, ready: ${!!this.processor}, active: ${this.active}, timeSource: ${this.timeSource}\n` +
        `├─ input: ${input ? `${input.width}×${input.height}` : "n/a"}, expected: ${this.options.size.width}×${this.options.size.height}, mediaTime: ${input?.mediaTime ?? "n/a"}, presentedFrames: ${input?.presentedFrames ?? "n/a"}\n` +
        `├─ callbacks: ${counts.callbacks}, lastCallbackAge: ${age(this.lastCallbackAt)}, captured: ${counts.captured}\n` +
        `├─ input checks: hidden=${counts.hidden}, sizeMismatch=${counts.sizeMismatch}, invalidTimestamp=${counts.invalidTimestamp}, duplicateFrames=${counts.duplicateFrames}\n` +
        `├─ GPU: started=${counts.gpuStarted}, completed=${counts.gpuCompleted}, busy=${this.busy}, pendingAge=${age(this.gpuStartedAt)}, lastDuration=${this.lastGpuDuration?.toFixed(1) ?? "n/a"} ms, lateMidpoints=${counts.lateMidpoints}\n` +
        `├─ output: ticks=${counts.ticks}, presentSubmitted=${counts.presentSubmitted}, displayedTime=${this.displayedTime ?? "n/a"} ms, queued=${this.queue.length}, canvas=${this.canvas.style.visibility}\n` +
        `└─ video: paused=${this.video.paused}, ended=${this.video.ended}, readyState=${this.video.readyState}, currentTime=${this.video.currentTime}, pageHidden=${typeof document !== "undefined" && document.hidden}` +
        (error === undefined ? "" : `\n   error: ${String(error)}`);
    });
  }
}
