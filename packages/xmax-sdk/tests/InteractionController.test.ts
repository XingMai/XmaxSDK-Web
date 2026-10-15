import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractionController } from "../src/Media/Interaction/InteractionController";
import { InteractionCoordinateMapper } from "../src/Media/Interaction/InteractionCoordinateMapper";
import type { InteractionFrame } from "../src/Media/Interaction/InteractionFrame";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { VideoContentMode } from "../src/Foundation/Media/Video/VideoContentMode";

const format = new RealtimeVideoFormat({ width: 1920, height: 1024, fps: 30 });
const frame: InteractionFrame = { viewportSize: { width: 960, height: 512 }, points: [{ x: 480, y: 256 }], contentMode: VideoContentMode.fill, mirrored: false };
afterEach(() => vi.restoreAllMocks());

describe("InteractionCoordinateMapper", () => {
  it("maps CSS pixels to model pixels and clamps the far edge", () => {
    expect(InteractionCoordinateMapper.map(frame.points[0]!, frame, format)).toEqual({ x: 960, y: 512 });
    expect(InteractionCoordinateMapper.map({ x: 960, y: 512 }, frame, format)).toEqual({ x: 1919, y: 1023 });
    expect(InteractionCoordinateMapper.map({ x: -5, y: -5 }, frame, format)).toEqual({ x: 0, y: 0 });
  });

  it("handles letterboxing, cover cropping and mirrored display", () => {
    const square = { ...frame, viewportSize: { width: 100, height: 100 } };
    const video = { width: 200, height: 100 };
    expect(InteractionCoordinateMapper.map({ x: 0, y: 50 }, square, video)).toEqual({ x: 50, y: 50 });
    expect(InteractionCoordinateMapper.map({ x: 0, y: 50 }, { ...square, mirrored: true }, video)).toEqual({ x: 150, y: 50 });
    const fit = { ...square, contentMode: VideoContentMode.fit };
    expect(InteractionCoordinateMapper.map({ x: 50, y: 10 }, fit, video)).toBeUndefined();
    expect(InteractionCoordinateMapper.map({ x: 50, y: 25 }, fit, video)).toEqual({ x: 100, y: 0 });
  });

  it("maps portrait video and rejects non-finite or empty dimensions", () => {
    const portrait = { width: 1024, height: 1920 };
    expect(InteractionCoordinateMapper.map({ x: 480, y: 256 }, frame, portrait)).toEqual({ x: 512, y: 960 });
    for (const value of [0, -1, NaN, Infinity]) {
      expect(InteractionCoordinateMapper.map({ x: 0, y: 0 }, frame, { width: value, height: 100 })).toBeUndefined();
      expect(InteractionCoordinateMapper.map({ x: 0, y: 0 }, { ...frame, viewportSize: { width: 100, height: value } }, format)).toBeUndefined();
    }
    expect(InteractionCoordinateMapper.map({ x: NaN, y: 0 }, frame, format)).toBeUndefined();
  });
});

describe("InteractionController", () => {
  it("ignores idle or empty input and maps all simultaneous touch points", async () => {
    const send = vi.fn(async () => {});
    const controller = new InteractionController(send);
    controller.submitInteraction(frame);
    expect(send).not.toHaveBeenCalled();
    controller.startInteraction("task", format);
    controller.submitInteraction({ ...frame, points: [] });
    expect(send).not.toHaveBeenCalled();
    controller.submitInteraction({ ...frame, points: [...frame.points, { x: 240, y: 128 }] });
    expect(send).toHaveBeenCalledWith("task", [{ x: 960, y: 512 }, { x: 480, y: 256 }]);
    await Promise.resolve();
    controller.stopInteraction();
    controller.submitInteraction(frame);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps only the latest pending frame while a send is in flight", async () => {
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const controller = new InteractionController(send);
    controller.startInteraction("task", format);
    controller.submitInteraction(frame);
    for (let x = 1; x <= 100; x++) {
      controller.submitInteraction({ ...frame, points: [{ x, y: 1 }] });
    }
    expect(send).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    expect(send).toHaveBeenLastCalledWith("task", [{ x: 200, y: 2 }]);
    expect(send).toHaveBeenCalledTimes(2);
    controller.stopInteraction();
    finish();
    await Promise.resolve();
  });

  it("drops pending old-task samples and starts a new task without waiting for an old send", async () => {
    let finish!: () => void;
    const send = vi.fn(async () => {});
    send.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const controller = new InteractionController(send);
    controller.startInteraction("old", format);
    controller.submitInteraction(frame);
    controller.submitInteraction(frame);
    controller.stopInteraction();
    controller.startInteraction("new", new RealtimeVideoFormat({ width: 1280, height: 720, fps: 30 }));
    controller.submitInteraction(frame);
    expect(send).toHaveBeenCalledTimes(2);
    finish();
    await Promise.resolve();
    expect(send).toHaveBeenNthCalledWith(1, "old", [{ x: 960, y: 512 }]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("new", [{ x: 640, y: 360 }]);
  });

  it("drops stopped pending samples and recovers from send failures", async () => {
    const send = vi.fn(async () => { throw new Error("network"); });
    const controller = new InteractionController(send);
    controller.startInteraction("task", format);
    controller.submitInteraction(frame);
    controller.submitInteraction(frame);
    controller.stopInteraction();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    controller.startInteraction("next", format);
    controller.submitInteraction(frame);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
