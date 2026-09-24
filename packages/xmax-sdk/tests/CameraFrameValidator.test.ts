import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForValidCameraFrame } from "../src/Foundation/Media/Camera/CameraFrameValidator";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";

function setup() {
  vi.useFakeTimers();
  const track = Object.assign(new EventTarget(), { readyState: "live", stop: vi.fn() });
  const controller = new AbortController();
  const start = () => waitForValidCameraFrame(track as unknown as MediaStreamTrack, controller.signal);
  return { track, controller, start };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("waitForValidCameraFrame", () => {
  it("固定等待 200ms 后放行", async () => {
    const s = setup();
    const pending = s.start();
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("不足 200ms 不提前放行", async () => {
    const s = setup();
    let resolved = false;
    const pending = s.start().then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(199);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toBe(true);
  });

  it("等待期间取消即拒绝，并清理定时器", async () => {
    const s = setup();
    const pending = expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    s.controller.abort();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("等待期间轨道结束即拒绝", async () => {
    const s = setup();
    const pending = expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    s.track.dispatchEvent(new Event("ended"));
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("已取消时不安排定时器", async () => {
    const s = setup();
    s.controller.abort();
    await expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("轨道已结束时不安排定时器", async () => {
    const s = setup();
    Object.assign(s.track, { readyState: "ended" });
    await expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("不停止原始轨道", async () => {
    const s = setup();
    const pending = s.start();
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(s.track.stop).not.toHaveBeenCalled();
  });
});
