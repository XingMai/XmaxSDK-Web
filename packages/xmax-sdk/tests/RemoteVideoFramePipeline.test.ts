import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteVideoFramePipeline } from "../src/Render/Video/RemoteVideoFramePipeline";

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
    size: { width: 320, height: 180 }, targetFrameRate: 60, onActiveChange, onFailure,
  }, create);
  pipeline.start();
  return { video, canvas, processor, pipeline, create, onActiveChange, onFailure, complete: () => complete() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  rafCallback = undefined;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { rafCallback = fn; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { rafCallback = undefined; });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("remote interpolation timeline presentation", () => {
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
