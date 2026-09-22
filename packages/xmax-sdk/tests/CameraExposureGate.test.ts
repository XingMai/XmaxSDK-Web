import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraExposureGate, waitForCameraExposure } from "../src/Foundation/Media/Camera/CameraExposureGate";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";

function pixels(luminance: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(64 * 48 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = luminance;
    data[i + 3] = 255;
  }
  return data;
}

describe("CameraExposureGate", () => {
  it.each([0, 8, 20])("稳定但欠曝的 %s 灰度画面不放行", (luminance) => {
    const gate = new CameraExposureGate();
    for (let time = 0; time < 5_000; time += 100) expect(gate.accept(pixels(luminance), time)).toBe(false);
  });

  it("少量亮灯不掩盖中央主体的暗像素", () => {
    const gate = new CameraExposureGate();
    const data = pixels(0);
    data.fill(255, 0, data.length / 4);
    for (let time = 0; time < 5_000; time += 100) expect(gate.accept(data, time)).toBe(false);
  });

  it("曝光爬升结束并连续稳定 400 ms 后放行", () => {
    const gate = new CameraExposureGate();
    [0, 10, 30, 55, 80, 110].forEach((value, index) => expect(gate.accept(pixels(value), index * 100)).toBe(false));
    for (let time = 600; time < 900; time += 100) expect(gate.accept(pixels(112), time)).toBe(false);
    expect(gate.accept(pixels(112), 900)).toBe(true);
  });

  it("突然变暗和采样中断会重置稳定窗口", () => {
    const gate = new CameraExposureGate();
    for (let time = 0; time <= 300; time += 100) gate.accept(pixels(100), time);
    expect(gate.accept(pixels(0), 400)).toBe(false);
    for (let time = 500; time <= 800; time += 100) expect(gate.accept(pixels(100), time)).toBe(false);
    expect(gate.accept(pixels(100), 1_100)).toBe(false);
    for (let time = 1_200; time < 1_500; time += 100) expect(gate.accept(pixels(100), time)).toBe(false);
    expect(gate.accept(pixels(100), 1_500)).toBe(true);
  });

  it("不能用重复时间戳累积稳定窗口", () => {
    const gate = new CameraExposureGate();
    for (let i = 0; i < 20; i++) expect(gate.accept(pixels(100), 0)).toBe(false);
  });
});

function setup(fallback = false) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  let data = pixels(0);
  let callback: VideoFrameRequestCallback | undefined;
  const video = {
    muted: false, autoplay: false, playsInline: false, srcObject: null,
    style: { cssText: "" }, readyState: 2, videoWidth: 1280, videoHeight: 720, currentTime: 0,
    setAttribute: vi.fn(), play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), remove: vi.fn(),
    requestVideoFrameCallback: fallback ? undefined : vi.fn((handler: VideoFrameRequestCallback) => { callback = handler; return 1; }),
    cancelVideoFrameCallback: vi.fn(() => { callback = undefined; }),
  };
  const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data })) };
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
  vi.stubGlobal("document", { createElement: (name: string) => name === "video" ? video : canvas, body: { appendChild: vi.fn() } });
  vi.stubGlobal("MediaStream", class { constructor(readonly tracks: MediaStreamTrack[]) {} });
  const track = Object.assign(new EventTarget(), { readyState: "live", muted: false, enabled: true, stop: vi.fn() });
  const controller = new AbortController();
  const start = () => waitForCameraExposure(track as unknown as MediaStreamTrack, controller.signal);
  const frame = (time: number, luminance = 100, mediaTime = time / 1_000) => {
    data = pixels(luminance);
    video.currentTime = mediaTime;
    const handler = callback;
    callback = undefined;
    handler?.(time, { mediaTime } as VideoFrameCallbackMetadata);
  };
  const cleaned = () => {
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.remove).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(track.stop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  };
  return { video, context, canvas, track, controller, start, frame, cleaned };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("waitForCameraExposure", () => {
  it("读取中央 60% 缩小画面，就绪后释放辅助资源但不停止相机", async () => {
    const s = setup();
    const pending = s.start();
    await Promise.resolve();
    s.frame(0, 0);
    for (let time = 100; time <= 500; time += 100) s.frame(time);
    await pending;
    expect(s.context.drawImage).toHaveBeenCalledWith(s.video, 256, 144, 768, 432, 0, 0, 64, 48);
    s.cleaned();
  });

  it.each(["dark", "stale", "muted", "disabled", "empty"])("%s 画面 5 秒后报错，不静默放行", async (kind) => {
    const s = setup();
    if (kind === "muted") s.track.muted = true;
    if (kind === "disabled") s.track.enabled = false;
    if (kind === "empty") s.video.videoWidth = 0;
    const pending = expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.cameraExposureTimeout });
    await Promise.resolve();
    for (let time = 0; time < 5_000; time += 100) s.frame(time, kind === "dark" ? 0 : 100, kind === "stale" ? 0 : time / 1_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;
    s.cleaned();
  });

  it("取消即时清理，即使 video.play 仍未完成", async () => {
    const s = setup();
    let resolvePlay!: () => void;
    s.video.play.mockImplementation(() => new Promise<void>((resolve) => { resolvePlay = resolve; }));
    const pending = expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    s.controller.abort();
    await pending;
    resolvePlay();
    await Promise.resolve();
    s.cleaned();
    expect(s.video.requestVideoFrameCallback).not.toHaveBeenCalled();
  });

  it("已取消时不创建采样资源", async () => {
    const s = setup();
    s.controller.abort();
    await expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(s.video.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("轨道结束立即失败并清理", async () => {
    const s = setup();
    const pending = expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    s.track.dispatchEvent(new Event("ended"));
    await pending;
    s.cleaned();
  });

  it("播放失败不会留下超时器或辅助视频", async () => {
    const s = setup();
    s.video.play.mockRejectedValue(new Error("play failed"));
    await expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    s.cleaned();
  });

  it("读取像素失败时不放行", async () => {
    const s = setup();
    s.context.getImageData.mockImplementation(() => { throw new Error("unavailable"); });
    const pending = expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    await Promise.resolve();
    s.frame(0);
    await pending;
    s.cleaned();
  });

  it("没有帧回调时轮询新帧，同一帧不会重复计数", async () => {
    const s = setup(true);
    const pending = s.start();
    s.frame(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.video.remove).not.toHaveBeenCalled();
    for (let time = 1_000; time <= 1_600; time += 100) {
      s.frame(time);
      await vi.advanceTimersByTimeAsync(100);
    }
    await pending;
    s.cleaned();
  });

  it("轮询优先检查实际帧计数，不把继续走的播放时钟当作新帧", async () => {
    const s = setup(true);
    Object.assign(s.video, { getVideoPlaybackQuality: () => ({ totalVideoFrames: 1 }) });
    const pending = expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.cameraExposureTimeout });
    for (let time = 0; time < 5_000; time += 100) {
      s.frame(time);
      await vi.advanceTimersByTimeAsync(100);
    }
    await pending;
    s.cleaned();
  });
});
