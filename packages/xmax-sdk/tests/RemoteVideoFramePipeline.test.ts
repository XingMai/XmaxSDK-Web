import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteVideoFramePipeline } from "../src/Render/Video/RemoteVideoFramePipeline";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";

class VideoStub {
  callbacks = new Map<number, VideoFrameRequestCallback>();
  sequence = 0;
  requestVideoFrameCallback(fn: VideoFrameRequestCallback) {
    const id = ++this.sequence;
    this.callbacks.set(id, fn);
    return id;
  }
  cancelVideoFrameCallback(id: number) { this.callbacks.delete(id); }
  frame(time: number, frames: number, width = 320, height = 180) {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((fn) => fn(performance.now(), { mediaTime: time, presentedFrames: frames, width, height } as VideoFrameCallbackMetadata));
  }
}

let rafCallback: FrameRequestCallback | undefined;
function tick(now: number) {
  const callback = rafCallback;
  rafCallback = undefined;
  callback?.(now);
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

function setup(options?: { deferred?: boolean; interpolationMs?: number }) {
  const video = new VideoStub();
  const canvas = { style: { visibility: "hidden" } } as HTMLCanvasElement;
  let nextSlot = 0;
  const processor = {
    capture: vi.fn(() => { const slot = nextSlot % 3; nextSlot += 1; return slot; }),
    interpolate: vi.fn((_previous: number, _current: number) => {
      const ms = options?.interpolationMs ?? 0;
      return ms > 0 ? new Promise<number>((resolve) => setTimeout(() => resolve(3), ms)) : Promise.resolve(3);
    }),
    present: vi.fn(),
    destroy: vi.fn(),
  };
  let complete!: () => void;
  const create = vi.fn(() => options?.deferred ? new Promise<typeof processor>((resolve) => { complete = () => resolve(processor); }) : Promise.resolve(processor));
  const onActiveChange = vi.fn();
  const onFailure = vi.fn();
  const pipeline = new RemoteVideoFramePipeline(video as unknown as HTMLVideoElement, canvas, {
    size: { width: 320, height: 180 }, onActiveChange, onFailure,
  }, create);
  pipeline.start();
  return { video, canvas, processor, pipeline, create, onActiveChange, onFailure, complete: () => complete() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
  XmaxLogger.configure(XmaxLoggerOption.none);
  rafCallback = undefined;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { rafCallback = fn; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { rafCallback = undefined; });
});
afterEach(() => {
  XmaxLogger.configure(XmaxLoggerOption.none);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("interpolation diagnostics", () => {
  function enableLogs() {
    XmaxLogger.configure(XmaxLoggerOption.business);
    return vi.spyOn(console, "info").mockImplementation(() => {});
  }

  it("samples stopped input callbacks without changing playback or triggering fallback", async () => {
    const log = enableLogs();
    const s = setup();
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(4000);

    const samples = log.mock.calls.flat().map(String).filter((text) => text.includes("event: sample"));
    expect(samples).toHaveLength(2);
    expect(samples[1]).toContain("callbacks: 2, lastCallbackAge: 4000 ms, captured: 1");
    expect(samples[1]).toContain("presentSubmitted=1");
    expect(s.canvas.style.visibility).toBe("visible");
    expect(s.processor.destroy).not.toHaveBeenCalled();
    expect(s.onFailure).not.toHaveBeenCalled();

    s.pipeline.stop();
    expect(vi.getTimerCount()).toBe(0);
    const count = log.mock.calls.length;
    await advance(4000);
    expect(log).toHaveBeenCalledTimes(count);
  });

  it("distinguishes non-advancing timestamps and mismatched dimensions from missing callbacks", async () => {
    const log = enableLogs();
    const s = setup();
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    s.video.frame(0.04, 3);
    s.video.frame(0.03, 4);
    s.video.frame(0.08, 5, 640, 360);
    await advance(2000);

    const sample = String(log.mock.calls.at(-1)?.[0]);
    expect(sample).toContain("input: 640×360, expected: 320×180");
    expect(sample).toContain("callbacks: 5");
    expect(sample).toContain("sizeMismatch=1, invalidTimestamp=2");
    expect(s.onFailure).not.toHaveBeenCalled();
    s.pipeline.stop();
  });

  it("reports pending initialization and the existing GPU timeout without adding recovery", async () => {
    const log = enableLogs();
    const initializing = setup({ deferred: true });
    initializing.video.frame(0, 1);
    await advance(2000);
    expect(String(log.mock.calls.at(-1)?.[0])).toContain("loading: true, ready: false");
    initializing.pipeline.stop();
    initializing.complete();
    await advance(0);

    const s = setup({ interpolationMs: 500 });
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(40);
    s.video.frame(0.08, 3);
    await advance(120);
    const failure = log.mock.calls.flat().map(String).find((text) => text.includes("event: failed"));
    expect(failure).toContain("started=1, completed=0, busy=true, pendingAge=120 ms");
    expect(failure).toContain("Interpolation GPU submission timed out");
    expect(s.onFailure).toHaveBeenCalledTimes(1);
    await advance(500);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a diagnostic timer with logging disabled", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const s = setup();
    expect(vi.getTimerCount()).toBe(0);
    await advance(4000);
    expect(log).not.toHaveBeenCalled();
    s.pipeline.stop();
  });
});

describe("remote interpolation timeline presentation", () => {
  it("interpolates new frames when Safari keeps mediaTime at zero", async () => {
    XmaxLogger.configure(XmaxLoggerOption.business);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const s = setup();
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0, 2);

    await advance(40);
    s.video.frame(0, 3);
    expect(s.processor.present).toHaveBeenLastCalledWith(1);
    expect(s.processor.interpolate).not.toHaveBeenCalled();

    await advance(40);
    s.video.frame(0, 4);
    await advance(0);
    expect(s.processor.interpolate).toHaveBeenCalledWith(1, 2);
    tick(1100);
    expect(s.processor.present).toHaveBeenLastCalledWith(3);
    tick(1120);
    expect(s.processor.present).toHaveBeenLastCalledWith(2);
    expect(s.processor.capture).toHaveBeenCalledTimes(3);
    expect(s.onFailure).not.toHaveBeenCalled();
    const switches = log.mock.calls.flat().map(String).filter((text) => text.includes("event: clock-fallback"));
    expect(switches).toHaveLength(1);
    expect(switches[0]).toContain("timeSource: callback");
    s.pipeline.stop();
  });

  it.each([NaN, Infinity, -Infinity])("uses callback time for non-finite mediaTime %s", async (time) => {
    const s = setup();
    await advance(1000);
    s.video.frame(time, 1);
    await advance(0);
    s.video.frame(time, 2);
    await advance(40);
    s.video.frame(time, 3);
    await advance(0);
    expect(s.processor.interpolate).toHaveBeenCalledWith(0, 1);
    tick(1060);
    expect(s.processor.present).toHaveBeenLastCalledWith(3);
    expect(s.onFailure).not.toHaveBeenCalled();
    s.pipeline.stop();
  });

  it("discards the old queue on clock change and keeps callback time after media time recovers", async () => {
    const s = setup();
    await advance(1000);
    s.video.frame(10, 1);
    await advance(0);
    s.video.frame(10, 2);
    await advance(40);
    s.video.frame(10.04, 3);
    await advance(0);
    // 旧媒体时间（约 10 秒）的原帧和中间帧都还在队列内。
    await advance(40);
    s.video.frame(0, 4);
    expect(s.processor.present).toHaveBeenLastCalledWith(2);
    const count = s.processor.present.mock.calls.length;
    tick(1090);
    expect(s.processor.present).toHaveBeenCalledTimes(count);

    await advance(40);
    s.video.frame(20, 5);
    await advance(0);
    expect(s.processor.interpolate).toHaveBeenLastCalledWith(2, 0);
    tick(1140);
    expect(s.processor.present).toHaveBeenLastCalledWith(3);
    tick(1160);
    expect(s.processor.present).toHaveBeenLastCalledWith(0);
    s.pipeline.stop();
  });

  it("does not capture repeated or out-of-order frame numbers in either clock mode", async () => {
    const s = setup();
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0, 2);
    await advance(40);
    s.video.frame(0, 2);
    s.video.frame(0.04, 1);
    expect(s.processor.capture).toHaveBeenCalledTimes(1);

    s.video.frame(0, 3);
    await advance(40);
    s.video.frame(0, 3);
    expect(s.processor.capture).toHaveBeenCalledTimes(2);
    s.video.frame(0, 4);
    await advance(0);
    expect(s.processor.interpolate).toHaveBeenCalledTimes(1);
    s.pipeline.stop();
  });

  it("discards in-flight interpolation from the previous clock", async () => {
    const s = setup({ interpolationMs: 50 });
    s.video.frame(10, 1);
    await advance(0);
    s.video.frame(10, 2);
    await advance(40);
    s.video.frame(10.04, 3);
    await advance(40);
    s.video.frame(0, 4);
    await advance(10);
    tick(100);
    expect(s.processor.present).toHaveBeenLastCalledWith(2);
    expect(s.processor.present).not.toHaveBeenCalledWith(3);
    expect(s.onFailure).not.toHaveBeenCalled();
    s.pipeline.stop();
  });

  it("preserves the existing GPU timeout across a clock change", async () => {
    const s = setup({ interpolationMs: 500 });
    s.video.frame(10, 1);
    await advance(0);
    s.video.frame(10, 2);
    await advance(40);
    s.video.frame(10.04, 3);
    await advance(40);
    s.video.frame(0, 4);
    await advance(80);
    expect(s.onFailure).toHaveBeenCalledTimes(1);
    expect(s.onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: "Interpolation GPU submission timed out" }));
    await advance(500);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("presents the original frame at its timestamp and the midpoint half an interval later", async () => {
    const s = setup();
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    // 处理器就绪后的第一帧直接显示，画布接管且不延迟。
    s.video.frame(0.04, 2);
    await advance(0);
    expect(s.processor.present).toHaveBeenLastCalledWith(0);
    expect(s.canvas.style.visibility).toBe("visible");
    expect(s.onActiveChange).toHaveBeenLastCalledWith(true);

    // 输出整体延迟一个源帧间隔，为中间帧留出计算窗口。
    await advance(40);
    s.video.frame(0.08, 3);
    await advance(0);
    expect(s.processor.interpolate).toHaveBeenCalledWith(0, 1);
    tick(1050); // 显示位置 50ms，中间帧与原帧都未到点
    expect(s.processor.present).toHaveBeenCalledTimes(1);
    tick(1060); // 到中点 60ms，显示中间帧
    expect(s.processor.present).toHaveBeenLastCalledWith(3);
    tick(1080); // 到 80ms，显示原帧
    expect(s.processor.present).toHaveBeenLastCalledWith(1);
    expect(s.onFailure).not.toHaveBeenCalled();
    s.pipeline.stop();
  });

  it("resumes from the latest frame after a stall instead of replaying queued content", async () => {
    const s = setup();
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(0);
    await advance(40);
    s.video.frame(0.08, 3);
    await advance(0);
    // 断流 600ms：旧队列清空，恢复帧直接显示。
    await advance(600);
    s.video.frame(0.68, 4);
    await advance(0);
    expect(s.processor.present).toHaveBeenLastCalledWith(2);
    expect(s.processor.interpolate).toHaveBeenCalledTimes(1);
    // 后续帧按新锚点恢复正常插值。
    await advance(40);
    s.video.frame(0.72, 5);
    await advance(0);
    expect(s.processor.interpolate).toHaveBeenLastCalledWith(2, 0);
    s.pipeline.stop();
  });

  it("never moves backward: size fallback shows the video element and reacquisition presents the current frame", async () => {
    const s = setup();
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(0);
    await advance(40);
    s.video.frame(0.08, 3);
    await advance(0);
    tick(1080);
    expect(s.processor.present).toHaveBeenLastCalledWith(1);
    // 尺寸不匹配期间回退到 video 元素。
    s.video.frame(0.12, 4, 640, 360);
    expect(s.canvas.style.visibility).toBe("hidden");
    expect(s.onActiveChange).toHaveBeenLastCalledWith(false);
    // 恢复后从当前帧重新接管，而不是补播旧内容。
    s.video.frame(0.16, 5);
    await advance(0);
    expect(s.processor.present).toHaveBeenLastCalledWith(2);
    expect(s.canvas.style.visibility).toBe("visible");
    s.pipeline.stop();
  });

  it("drops a midpoint whose display time has already passed", async () => {
    const s = setup({ interpolationMs: 100 });
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(0);
    await advance(40);
    s.video.frame(0.08, 3);
    // 插值 100ms 后才完成，显示位置 100ms 已越过 60ms 中点：中间帧直接丢弃。
    await advance(100);
    tick(1200);
    tick(1300);
    expect(s.processor.present).not.toHaveBeenCalledWith(3);
    s.pipeline.stop();
  });

  it("skips interpolation while the GPU is busy but keeps presenting originals", async () => {
    const s = setup({ interpolationMs: 100 });
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(0);
    await advance(40);
    s.video.frame(0.08, 3);
    await advance(40);
    // 上一对插值未完成：新原帧照常入队显示，不再发起插值。
    s.video.frame(0.12, 4);
    await advance(0);
    expect(s.processor.interpolate).toHaveBeenCalledTimes(1);
    tick(1100); // 显示位置 100ms，只有第一张开点
    expect(s.processor.present).toHaveBeenLastCalledWith(1);
    tick(1160); // 显示位置 160ms，第二张到点
    expect(s.processor.present).toHaveBeenLastCalledWith(2);
    await advance(100);
    s.pipeline.stop();
  });

  it("passes through dropped input frames without interpolating across the gap", async () => {
    const s = setup();
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(0);
    await advance(40);
    // presentedFrames 跳号：不做跨缺口插值，原帧照常显示。
    s.video.frame(0.08, 4);
    await advance(0);
    expect(s.processor.interpolate).not.toHaveBeenCalled();
    tick(1080);
    expect(s.processor.present).toHaveBeenLastCalledWith(1);
    s.pipeline.stop();
  });

  it("falls back after repeated GPU overruns without accumulating work", async () => {
    const s = setup({ interpolationMs: 25 });
    await advance(1000);
    s.video.frame(0, 1);
    await advance(1);
    s.video.frame(0.04, 2);
    await advance(0);
    for (let n = 2; n <= 7; n++) {
      await advance(40);
      s.video.frame(n * 0.04, n + 1);
      await advance(0);
    }
    expect(s.onFailure).toHaveBeenCalledTimes(1);
    expect(s.processor.destroy).toHaveBeenCalledTimes(1);
    expect(s.canvas.style.visibility).toBe("hidden");
    expect(s.video.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not initialize before matching frames arrive and disposes a late initialization after stop", async () => {
    const s = setup({ deferred: true });
    s.video.frame(0, 1, 640, 360);
    expect(s.create).not.toHaveBeenCalled();
    s.video.frame(0.04, 2);
    s.pipeline.stop();
    s.complete();
    await Promise.resolve();
    expect(s.processor.destroy).toHaveBeenCalledTimes(1);
    expect(s.canvas.style.visibility).toBe("hidden");
    expect(s.onFailure).not.toHaveBeenCalled();
  });

  it("times out initialization and releases its eventual result", async () => {
    const s = setup({ deferred: true });
    s.video.frame(0, 1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(s.onFailure).toHaveBeenCalledTimes(1);
    s.complete();
    await Promise.resolve();
    expect(s.processor.destroy).toHaveBeenCalledTimes(1);
  });

  it("stop releases the frame callback, the display tick and the processor", async () => {
    const s = setup();
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(0);
    s.pipeline.stop();
    expect(s.video.callbacks.size).toBe(0);
    expect(s.processor.destroy).toHaveBeenCalledTimes(1);
    expect(s.canvas.style.visibility).toBe("hidden");
    expect(s.onActiveChange).toHaveBeenLastCalledWith(false);
    tick(1200);
    expect(s.processor.present).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.onFailure).not.toHaveBeenCalled();
  });
});
