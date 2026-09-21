import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteVideoFramePipeline } from "../src/Render/Video/RemoteVideoFramePipeline";

class VideoStub {
  mediaTime = 0;
  onNativeFrame?: (time: number) => void;
  callbacks = new Map<number, VideoFrameRequestCallback>();
  sequence = 0;
  requestVideoFrameCallback(fn: VideoFrameRequestCallback) {
    const id = ++this.sequence;
    this.callbacks.set(id, fn);
    return id;
  }
  cancelVideoFrameCallback(id: number) { this.callbacks.delete(id); }
  frame(time: number, frames: number, width = 320, height = 180, expectedDisplayTime = performance.now()) {
    this.mediaTime = time;
    this.onNativeFrame?.(time);
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((fn) => fn(performance.now(), { mediaTime: time, presentedFrames: frames, width, height, expectedDisplayTime } as VideoFrameCallbackMetadata));
  }
}

function setup(options?: { deferred?: boolean; slow?: boolean; pendingGPU?: boolean }) {
  const video = new VideoStub();
  const canvas = { style: { visibility: "hidden" } } as HTMLCanvasElement;
  const displayed: number[] = [];
  video.onNativeFrame = (time) => { if (canvas.style.visibility === 'hidden') displayed.push(time); };
  let previous = 0, current = 0;
  let finishGPU!: () => void;
  const processor = {
    capture: vi.fn(() => { previous = current; current = video.mediaTime; }),
    presentCurrent: vi.fn(() => { displayed.push(current); }),
    presentPrevious: vi.fn(() => { displayed.push(previous); }),
    presentInterpolated: vi.fn(() => { displayed.push((previous + current) / 2); }),
    destroy: vi.fn(),
    interpolate: vi.fn(() => options?.pendingGPU ? new Promise<void>((resolve) => { finishGPU = resolve; })
      : options?.slow ? new Promise<void>((resolve) => setTimeout(resolve, 25)) : Promise.resolve()),
  };
  let complete!: () => void;
  const create = vi.fn(() => options?.deferred ? new Promise<typeof processor>((resolve) => { complete = () => resolve(processor); }) : Promise.resolve(processor));
  const onActiveChange = vi.fn();
  const onFailure = vi.fn();
  const pipeline = new RemoteVideoFramePipeline(video as unknown as HTMLVideoElement, canvas, {
    size: { width: 320, height: 180 }, targetFrameRate: 60, onActiveChange, onFailure,
  }, create);
  pipeline.start();
  return { video, canvas, processor, pipeline, create, onActiveChange, onFailure, displayed,
    complete: () => complete(), finishGPU: () => finishGPU() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("remote interpolation lifecycle and presentation", () => {
  it("takes over on the current frame, then presents midpoints and endpoints in order", async () => {
    const s = setup();
    s.video.frame(0, 1);
    await vi.advanceTimersByTimeAsync(1);
    s.video.frame(0.04, 2);
    await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.08, 3);
    expect(s.processor.presentCurrent).toHaveBeenCalledTimes(1);
    expect(s.processor.presentPrevious).not.toHaveBeenCalled(); // B is already visible; never replay A.
    await vi.advanceTimersByTimeAsync(22);
    expect(s.processor.presentInterpolated).toHaveBeenCalledTimes(1);
    expect(s.onActiveChange).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(s.displayed).toEqual([0, 0.04, 0.04, 0.06, 0.08]);
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

  it("keeps gaps on canvas, releases it for size changes, and holds the final original on stall", async () => {
    const s = setup();
    s.video.frame(0, 1);
    await Promise.resolve();
    s.video.frame(0.04, 2);
    s.video.frame(0.08, 4); // a dropped input frame
    expect(s.processor.interpolate).not.toHaveBeenCalled();
    expect(s.canvas.style.visibility).toBe('visible');
    s.video.frame(0.12, 5);
    await vi.advanceTimersByTimeAsync(22);
    expect(s.canvas.style.visibility).toBe("visible");
    s.video.frame(0.16, 6, 640, 360);
    expect(s.canvas.style.visibility).toBe("hidden");
    s.video.frame(0.20, 7);
    s.video.frame(0.24, 8);
    await vi.advanceTimersByTimeAsync(150);
    expect(s.canvas.style.visibility).toBe("visible");
    expect(s.displayed.at(-1)).toBe(0.24);
    expect(s.onActiveChange).toHaveBeenLastCalledWith(true);
    s.pipeline.stop();
  });

  it('never exposes the live video during interval jitter or dropped callbacks', async () => {
    const s = setup();
    s.video.frame(0, 1); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.04, 2); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.08, 3); await vi.advanceTimersByTimeAsync(21);
    expect(s.displayed.at(-1)).toBe(0.06);
    await vi.advanceTimersByTimeAsync(10);
    s.video.frame(0.111, 4); // Too short for the 60fps budget: bypass interpolation, not canvas.
    expect(s.canvas.style.visibility).toBe('visible');
    await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.151, 5); await vi.advanceTimersByTimeAsync(22);
    await vi.advanceTimersByTimeAsync(58);
    s.video.frame(0.231, 7); // Missing callback/frame.
    expect(s.canvas.style.visibility).toBe('visible');
    await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.271, 8); await vi.advanceTimersByTimeAsync(42);
    expect(s.displayed.every((time, i) => i === 0 || time >= s.displayed[i - 1]!)).toBe(true);
    expect(s.onActiveChange.mock.calls).toEqual([[true]]);
    s.pipeline.stop();
  });

  it('discards a queued midpoint when an early input advances to a newer original', async () => {
    const s = setup();
    s.video.frame(0, 1); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.04, 2); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.08, 3); await vi.advanceTimersByTimeAsync(10);
    s.video.frame(0.10, 4); // Show current .10 before the old .06 midpoint is due.
    await vi.advanceTimersByTimeAsync(80);
    expect(s.displayed.at(-1)).toBe(0.10);
    expect(s.processor.presentInterpolated).not.toHaveBeenCalled();
    s.pipeline.stop();
  });

  it('invalidates a busy pair without exposing video or overwriting its input textures', async () => {
    const s = setup({ pendingGPU: true });
    s.video.frame(0, 1); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.04, 2); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.08, 3); await vi.advanceTimersByTimeAsync(10);
    const captured = s.processor.capture.mock.calls.length;
    s.video.frame(0.12, 4);
    expect(s.processor.capture).toHaveBeenCalledTimes(captured);
    expect(s.displayed.at(-1)).toBe(0.08);
    expect(s.canvas.style.visibility).toBe('visible');
    s.finishGPU(); await vi.advanceTimersByTimeAsync(40);
    expect(s.processor.presentInterpolated).not.toHaveBeenCalled();
    s.video.frame(0.16, 5); // Resync directly on current frame because .12 was dropped.
    expect(s.displayed.at(-1)).toBe(0.16);
    expect(s.displayed.every((time, i) => i === 0 || time >= s.displayed[i - 1]!)).toBe(true);
    s.pipeline.stop();
  });

  it('keeps the GPU watchdog armed even when a busy pair is invalidated', async () => {
    const s = setup({ pendingGPU: true });
    s.video.frame(0, 1); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.04, 2); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.08, 3); await vi.advanceTimersByTimeAsync(10);
    s.video.frame(0.12, 4); await vi.advanceTimersByTimeAsync(115);
    expect(s.onFailure).toHaveBeenCalledTimes(1);
    expect(s.canvas.style.visibility).toBe('hidden');
    const count = s.displayed.length;
    s.finishGPU(); await vi.advanceTimersByTimeAsync(100);
    expect(s.displayed).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not rebase a delayed video callback onto its arrival time', async () => {
    const s = setup();
    s.video.frame(0, 1); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.04, 2); await vi.advanceTimersByTimeAsync(80);
    s.video.frame(0.08, 3, 320, 180, 80); // Already at the .08 endpoint deadline (120ms).
    expect(s.processor.interpolate).not.toHaveBeenCalled();
    expect(s.displayed.at(-1)).toBe(0.08);
    s.pipeline.stop();
  });

  it('drops a midpoint when requestAnimationFrame runs after the endpoint deadline', async () => {
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 30));
    const s = setup();
    s.video.frame(0, 1); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.04, 2); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.08, 3); await vi.advanceTimersByTimeAsync(75);
    expect(s.processor.presentInterpolated).not.toHaveBeenCalled();
    expect(s.displayed.at(-1)).toBe(0.08);
    s.pipeline.stop();
  });

  it('ignores repeated/backward timestamps without rewinding its captured pair', async () => {
    const s = setup();
    s.video.frame(0, 1); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.04, 2);
    const count = s.processor.capture.mock.calls.length;
    s.video.frame(0.04, 3); s.video.frame(0.02, 4);
    expect(s.processor.capture).toHaveBeenCalledTimes(count);
    expect(s.displayed.at(-1)).toBe(0.04);
    s.pipeline.stop();
  });

  it('does not restore an invalidated GPU result after a size reset', async () => {
    const s = setup({ pendingGPU: true });
    s.video.frame(0, 1); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.04, 2); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.08, 3);
    s.video.frame(0.12, 4, 640, 360);
    expect(s.canvas.style.visibility).toBe('hidden');
    s.finishGPU(); await vi.advanceTimersByTimeAsync(1);
    expect(s.processor.presentInterpolated).not.toHaveBeenCalled();
    s.video.frame(0.16, 5);
    expect(s.displayed.at(-1)).toBe(0.16);
    expect(s.processor.presentPrevious).not.toHaveBeenCalled();
    expect(s.canvas.style.visibility).toBe('visible');
    s.pipeline.stop();
  });

  it('cancels both pending midpoint and endpoint presentations when stopped', async () => {
    const s = setup();
    s.video.frame(0, 1); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.04, 2); await vi.advanceTimersByTimeAsync(40);
    s.video.frame(0.08, 3); await vi.advanceTimersByTimeAsync(1);
    const count = s.displayed.length;
    s.pipeline.stop(); await vi.advanceTimersByTimeAsync(200);
    expect(s.displayed).toHaveLength(count);
    expect(s.canvas.style.visibility).toBe('hidden');
    expect(vi.getTimerCount()).toBe(0);
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
