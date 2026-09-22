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
  let midpointFlip = 0;
  const processor = {
    capture: vi.fn(() => { const slot = nextSlot % 4; nextSlot += 1; return slot; }),
    interpolate: vi.fn((_previous: number, _current: number) => {
      const slot = 4 + midpointFlip;
      midpointFlip = 1 - midpointFlip;
      const ms = options?.interpolationMs ?? 0;
      return ms > 0 ? new Promise<number>((resolve) => setTimeout(() => resolve(slot), ms)) : Promise.resolve(slot);
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

describe("remote interpolation scheduled playback", () => {
  it("shows the midpoint and the original frame for half an interval each", async () => {
    const s = setup();
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    // 处理器就绪后的第一帧直接显示，画布接管。
    s.video.frame(0.04, 2);
    await advance(0);
    expect(s.processor.present).toHaveBeenLastCalledWith(0);
    expect(s.canvas.style.visibility).toBe("visible");
    expect(s.onActiveChange).toHaveBeenLastCalledWith(true);

    await advance(40);
    s.video.frame(0.08, 3);
    await advance(0);
    expect(s.processor.interpolate).toHaveBeenCalledWith(0, 1);
    // 窗口从排期时刻 1040 依次排开：中间帧 [1040,1060)，原帧 [1060,1080)。
    tick(1045);
    expect(s.processor.present).toHaveBeenLastCalledWith(4);
    tick(1065);
    expect(s.processor.present).toHaveBeenLastCalledWith(1);
    expect(s.onFailure).not.toHaveBeenCalled();
    s.pipeline.stop();
  });

  it("never drops a slow midpoint: the whole output shifts later instead", async () => {
    const s = setup({ interpolationMs: 25 });
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(0);
    await advance(40);
    s.video.frame(0.08, 3);
    // 插值 25ms 后完成，窗口顺延到 [1065,1085) 与 [1085,1105)，中间帧照常显示。
    await advance(25);
    tick(1070);
    expect(s.processor.present).toHaveBeenLastCalledWith(4);
    tick(1090);
    expect(s.processor.present).toHaveBeenLastCalledWith(1);
    s.pipeline.stop();
  });

  it("coalesces input while the GPU is busy and keeps every processed pair at an even cadence", async () => {
    const s = setup({ interpolationMs: 60 });
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(0);
    await advance(40);
    s.video.frame(0.08, 3); // 开始第一对插值
    await advance(40);
    s.video.frame(0.12, 4); // 插值进行中，只保留为最新输入
    await advance(20); // 1100：第一对完成，窗口 [1100,1120) [1120,1140)，第二对立即开始
    expect(s.processor.interpolate).toHaveBeenCalledTimes(2);
    tick(1110);
    expect(s.processor.present).toHaveBeenLastCalledWith(4);
    tick(1130);
    expect(s.processor.present).toHaveBeenLastCalledWith(1);
    await advance(40);
    s.video.frame(0.16, 5); // 第二对仍在进行，合并为最新输入
    await advance(20); // 1160：第二对完成，窗口顺延到 [1160,1180) [1180,1200)，第三对立即开始
    expect(s.processor.interpolate).toHaveBeenCalledTimes(3);
    tick(1170);
    expect(s.processor.present).toHaveBeenLastCalledWith(5);
    tick(1190);
    expect(s.processor.present).toHaveBeenLastCalledWith(2);
    s.pipeline.stop();
  });

  it("passes through intervals below the output budget without interpolating", async () => {
    const s = setup();
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(0);
    await advance(20);
    s.video.frame(0.06, 3);
    await advance(0);
    expect(s.processor.interpolate).not.toHaveBeenCalled();
    tick(1025);
    expect(s.processor.present).toHaveBeenLastCalledWith(1);
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
    // 后续帧恢复正常插值。
    await advance(40);
    s.video.frame(0.72, 5);
    await advance(0);
    expect(s.processor.interpolate).toHaveBeenLastCalledWith(2, 3);
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
    tick(1045);
    expect(s.processor.present).toHaveBeenLastCalledWith(4);
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

  it("falls back only after five consecutive pairs exceed a full source interval", async () => {
    const s = setup({ interpolationMs: 45 });
    await advance(1000);
    s.video.frame(0, 1);
    await advance(0);
    s.video.frame(0.04, 2);
    await advance(0);
    // 每对插值 45ms，超过 40ms 源帧间隔；连续 5 对才降级。
    for (let n = 2; n <= 7; n++) {
      await advance(40);
      s.video.frame(n * 0.04, n + 1);
      await advance(45);
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
