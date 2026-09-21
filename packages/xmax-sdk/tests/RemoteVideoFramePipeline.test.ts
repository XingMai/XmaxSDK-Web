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

function setup(options?: { deferred?: boolean; slow?: boolean }) {
  const video = new VideoStub();
  const canvas = { style: { visibility: "hidden" } } as HTMLCanvasElement;
  const processor = {
    capture: vi.fn(), presentPrevious: vi.fn(), presentInterpolated: vi.fn(), destroy: vi.fn(),
    interpolate: vi.fn(() => options?.slow ? new Promise<void>((resolve) => setTimeout(resolve, 25)) : Promise.resolve()),
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
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("remote interpolation lifecycle and presentation", () => {
  it("outputs the previous frame and then the midpoint, and releases the entire pipeline on stop", async () => {
    const s = setup();
    s.video.frame(0, 1);
    await vi.advanceTimersByTimeAsync(1);
    s.video.frame(0.04, 2);
    await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.08, 3);
    expect(s.processor.presentPrevious).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(22);
    expect(s.processor.presentInterpolated).toHaveBeenCalledTimes(1);
    expect(s.onActiveChange).toHaveBeenLastCalledWith(true);
    s.pipeline.stop();
    expect(s.video.callbacks.size).toBe(0);
    expect(s.processor.destroy).toHaveBeenCalledTimes(1);
    expect(s.canvas.style.visibility).toBe("hidden");
    expect(s.onActiveChange).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.onFailure).not.toHaveBeenCalled();
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

  it("bypasses discontinuities and size changes; stalled video stops displaying an old midpoint", async () => {
    const s = setup();
    s.video.frame(0, 1);
    await Promise.resolve();
    s.video.frame(0.04, 2);
    s.video.frame(0.08, 4); // a dropped input frame
    expect(s.processor.interpolate).not.toHaveBeenCalled();
    s.video.frame(0.12, 5);
    await vi.advanceTimersByTimeAsync(22);
    expect(s.canvas.style.visibility).toBe("visible");
    s.video.frame(0.16, 6, 640, 360);
    expect(s.canvas.style.visibility).toBe("hidden");
    s.video.frame(0.20, 7);
    s.video.frame(0.24, 8);
    await vi.advanceTimersByTimeAsync(150);
    expect(s.canvas.style.visibility).toBe("hidden");
    expect(s.onActiveChange).toHaveBeenLastCalledWith(false);
    s.pipeline.stop();
  });

  it("falls back after repeated GPU overruns without accumulating work", async () => {
    const s = setup({ slow: true });
    s.video.frame(0, 1);
    await vi.advanceTimersByTimeAsync(1);
    for (let n = 1; n <= 7; n++) {
      s.video.frame(n * 0.04, n + 1);
      await vi.advanceTimersByTimeAsync(40);
    }
    expect(s.onFailure).toHaveBeenCalledTimes(1);
    expect(s.processor.destroy).toHaveBeenCalledTimes(1);
    expect(s.canvas.style.visibility).toBe("hidden");
    expect(s.video.callbacks.size).toBe(0);
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
});
