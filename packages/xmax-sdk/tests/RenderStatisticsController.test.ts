import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RenderStatisticsController } from "../src/Render/Video/RenderStatisticsController";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";

function setup() {
  let sequence = 0;
  const callbacks = new Map<number, () => void>();
  const video = {
    srcObject: {} as MediaStream | null,
    getAttribute: () => null,
    requestVideoFrameCallback: (callback: () => void) => {
      callbacks.set(++sequence, callback);
      return sequence;
    },
    cancelVideoFrameCallback: (id: number) => callbacks.delete(id),
  };
  const collector = new RenderStatisticsController(video as unknown as HTMLVideoElement);
  const frame = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback());
  };
  return { collector, video, callbacks, frame };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  vi.stubGlobal("document", { hidden: false });
  XmaxLogger.configure(XmaxLoggerOption.none);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  XmaxLogger.configure(XmaxLoggerOption.none);
});

it("starts only with a media source and a statistics consumer", () => {
  const { collector, video, callbacks } = setup();
  collector.start();
  expect(vi.getTimerCount()).toBe(0);
  collector.handler = vi.fn();
  video.srcObject = null;
  collector.start();
  expect(callbacks.size).toBe(0);
  video.srcObject = {} as MediaStream;
  collector.start();
  collector.start();
  expect(vi.getTimerCount()).toBe(1);
  expect(callbacks.size).toBe(1);
  collector.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("samples video and canvas separately and resets the window on output changes", async () => {
  const { collector, frame } = setup();
  const listener = vi.fn();
  collector.handler = listener;
  collector.start();
  for (let i = 0; i < 25; i++) frame();
  await vi.advanceTimersByTimeAsync(1000);
  expect(listener).toHaveBeenLastCalledWith({ source: "video", frameRate: 25, originalFrameRate: 25, interpolatedFrameRate: 0 });

  collector.setInterpolationActive(true);
  for (let i = 0; i < 25; i++) {
    frame();
    collector.recordCanvasFrame(false);
    collector.recordCanvasFrame(true);
  }
  await vi.advanceTimersByTimeAsync(1000);
  expect(listener).toHaveBeenLastCalledWith({ source: "canvas", frameRate: 50, originalFrameRate: 25, interpolatedFrameRate: 25 });

  collector.recordCanvasFrame(true);
  collector.setInterpolationActive(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(listener).toHaveBeenLastCalledWith({ source: "video", frameRate: 0, originalFrameRate: 0, interpolatedFrameRate: 0 });
  collector.stop();
});

it("invalidates queued callbacks after restart and clears background samples", async () => {
  const { collector, callbacks, frame } = setup();
  const listener = vi.fn();
  collector.handler = listener;
  collector.start();
  const oldCallback = [...callbacks.values()][0]!;
  collector.stop();
  collector.start();
  oldCallback();
  expect(callbacks.size).toBe(1);
  frame();
  vi.stubGlobal("document", { hidden: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(listener).toHaveBeenLastCalledWith(undefined);
  vi.stubGlobal("document", { hidden: false });
  await vi.advanceTimersByTimeAsync(1000);
  expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ frameRate: 0 }));
  collector.stop();
  expect(callbacks.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
