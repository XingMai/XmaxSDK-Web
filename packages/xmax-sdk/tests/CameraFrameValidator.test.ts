import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraFrameValidator, waitForValidCameraFrame } from "../src/Foundation/Media/Camera/CameraFrameValidator";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { XmaxLogger } from "../src/Foundation/Logging/XmaxLogger";

function pixels(luminance: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(64 * 48 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = luminance;
    data[i + 3] = 255;
  }
  return data;
}

describe("CameraFrameValidator", () => {
  it.each([0, 8, 20])("稳定但欠曝的 %s 灰度画面不放行", (luminance) => {
    const gate = new CameraFrameValidator();
    for (let i = 0; i < 50; i++) expect(gate.accept(pixels(luminance))).toBe(false);
  });

  it("少量亮灯不掩盖中央主体的暗像素", () => {
    const gate = new CameraFrameValidator();
    const data = pixels(0);
    data.fill(255, 0, data.length / 4);
    expect(gate.accept(data)).toBe(false);
  });

  it("曝光仍在爬升时第一张合格帧立即放行", () => {
    const gate = new CameraFrameValidator();
    [0, 10, 23].forEach((value) => expect(gate.accept(pixels(value))).toBe(false));
    expect(gate.accept(pixels(24))).toBe(true);
    expect(gate.accept(pixels(80))).toBe(true);
  });

  it("初始帧已经合格时不需要其他帧", () => {
    const gate = new CameraFrameValidator();
    expect(gate.accept(pixels(100))).toBe(true);
  });

  it("空像素或不完整的像素数据不放行", () => {
    const gate = new CameraFrameValidator();
    expect(gate.accept(new Uint8ClampedArray())).toBe(false);
    expect(gate.accept(new Uint8ClampedArray(3))).toBe(false);
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
  const start = () => waitForValidCameraFrame(track as unknown as MediaStreamTrack, controller.signal);
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

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("waitForValidCameraFrame", () => {
  it("读取中央 60% 缩小画面，就绪后释放辅助资源但不停止相机", async () => {
    const s = setup();
    const pending = s.start();
    await Promise.resolve();
    s.frame(0, 0);
    expect(s.video.remove).not.toHaveBeenCalled();
    s.frame(33);
    await pending;
    expect(s.context.drawImage).toHaveBeenCalledWith(s.video, 256, 144, 768, 432, 0, 0, 64, 48);
    s.cleaned();
  });

  it("首帧已经足够亮时同步清理，不等计时器或第二帧", async () => {
    const s = setup();
    const pending = s.start();
    await Promise.resolve();
    s.frame(0);
    expect(s.video.remove).toHaveBeenCalledOnce();
    await pending;
    s.cleaned();
  });

  it("重复帧不重新采样，33 ms 后的新合格帧直接放行", async () => {
    const s = setup();
    const pending = s.start();
    await Promise.resolve();
    s.frame(0, 0);
    s.frame(16, 100, 0);
    expect(s.context.getImageData).toHaveBeenCalledTimes(1);
    expect(s.video.remove).not.toHaveBeenCalled();
    s.frame(33);
    expect(s.video.remove).toHaveBeenCalledOnce();
    await pending;
    s.cleaned();
  });

  it.each(["dark", "stale", "muted", "disabled", "empty"])("%s 画面 2 秒后警告放行，不阻断流程", async (kind) => {
    const s = setup();
    const warning = vi.spyOn(XmaxLogger.media, "warning");
    const info = vi.spyOn(XmaxLogger.media, "info");
    if (kind === "muted") s.track.muted = true;
    if (kind === "disabled") s.track.enabled = false;
    if (kind === "empty") s.video.videoWidth = 0;
    const pending = s.start();
    await Promise.resolve();
    for (let time = 0; time < 2_000; time += 100) s.frame(time, kind === "dark" || time === 0 ? 0 : 100, kind === "stale" ? 0 : time / 1_000);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(s.video.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]![0]()).toContain("Continuing");
    expect(info.mock.calls.map(([message]) => message()).join("\n")).not.toContain("Camera Exposure Ready");
    s.cleaned();
  });

  it("播放就绪超时后仍清理资源，迟到的播放完成不会重新启动采样", async () => {
    const s = setup();
    let resolvePlay!: () => void;
    s.video.play.mockImplementation(() => new Promise<void>((resolve) => { resolvePlay = resolve; }));
    const pending = s.start();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toBeUndefined();
    resolvePlay();
    await Promise.resolve();
    s.cleaned();
    expect(s.video.requestVideoFrameCallback).not.toHaveBeenCalled();
  });

  it("超时前主动取消仍拒绝，不因超时定时器继续流程", async () => {
    const s = setup();
    const warning = vi.spyOn(XmaxLogger.media, "warning");
    const pending = expect(s.start()).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await vi.advanceTimersByTimeAsync(1_999);
    s.controller.abort();
    await pending;
    await vi.advanceTimersByTimeAsync(1);
    expect(warning).not.toHaveBeenCalled();
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

  it("没有帧回调时轮询新帧，不重复采样，首张合格帧即放行", async () => {
    const s = setup(true);
    const pending = s.start();
    s.frame(0, 0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.video.remove).not.toHaveBeenCalled();
    expect(s.context.getImageData).toHaveBeenCalledTimes(1);
    s.frame(1_000);
    await vi.advanceTimersByTimeAsync(16);
    await pending;
    s.cleaned();
  });

  it("轮询优先检查实际帧计数，不把继续走的播放时钟当作新帧", async () => {
    const s = setup(true);
    Object.assign(s.video, { getVideoPlaybackQuality: () => ({ totalVideoFrames: 1 }) });
    const pending = s.start();
    for (let time = 0; time < 2_000; time += 100) {
      s.frame(time, time === 0 ? 0 : 100);
      await vi.advanceTimersByTimeAsync(100);
    }
    await expect(pending).resolves.toBeUndefined();
    expect(s.context.getImageData).toHaveBeenCalledTimes(1);
    s.cleaned();
  });
});
