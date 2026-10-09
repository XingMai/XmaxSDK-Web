import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameInterpolationManager } from "../src/Foundation/Media/Video/FrameInterpolationManager";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";
import { XmaxVideoView } from "../src/Render/Video/XmaxVideoView";
import { XmaxRealtimeVideoView } from "../src/Render/Video/XmaxRealtimeVideoView";
import { RealtimeVideoTrack } from "../src/Service/Realtime/RealtimeVideoTrack";
import { VideoRenderRegistry } from "../src/Service/Realtime/VideoRenderBinding";
import { NetworkVideoController } from "../src/Media/Video/NetworkVideoController";
import { MediaService } from "../src/Service/Media/MediaService";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoSampleMethod } from "../src/Service/Realtime/RealtimeReferenceVideo";

class ElementStub extends EventTarget {
  style: Record<string, string> = {};
  appendChild(): void {}
  remove(): void {}
}

class VideoStub extends ElementStub {
  src = "";
  currentTime = 0;
  duration = 10;
  ended = false;
  muted = false;
  loop = false;
  autoplay = true;
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  getAttribute(name: string): string | null { return name === "src" ? this.src || null : null; }
  removeAttribute(name: string): void { if (name === "src") this.src = ""; }
  srcObject: MediaStream | null = null;
  paused = true;
  readyState = 0;
  play = vi.fn(async () => { this.paused = false; });
  private sequence = 0;
  readonly callbacks = new Map<number, () => void>();

  requestVideoFrameCallback(callback: () => void): number {
    const id = ++this.sequence;
    this.callbacks.set(id, callback);
    return id;
  }

  cancelVideoFrameCallback(id: number): void {
    this.callbacks.delete(id);
  }

  nextFrame(time = 0, frames = 1): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => (callback as VideoFrameRequestCallback)(performance.now(), {
      mediaTime: time, presentedFrames: frames, width: 320, height: 180,
    } as VideoFrameCallbackMetadata));
  }
}

function makeView(useFrameCallback = true) {
  const video = new VideoStub();
  if (!useFrameCallback) {
    Object.defineProperty(video, "requestVideoFrameCallback", { value: undefined });
  }
  vi.stubGlobal("document", {
    createElement: (tag: string) => tag === "video" ? video : new ElementStub(),
  });
  const view = new XmaxVideoView();
  const track = new RealtimeVideoTrack({ id: "remote" });
  const onBindingFrame = vi.fn();
  const onViewFrame = vi.fn();
  view.frameDisplayHandler = onViewFrame;
  VideoRenderRegistry.register(track, {
    attachHandler: (target) => target.setMediaStream({} as MediaStream),
    detachHandler: (target) => target.setMediaStream(null),
    frameDisplayHandler: onBindingFrame,
  });
  view.track = track;
  return { view, video, onBindingFrame, onViewFrame };
}

describe("video render statistics", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
    XmaxLogger.configure(XmaxLoggerOption.none);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    XmaxLogger.configure(XmaxLoggerOption.none);
  });

  it("reports video frame callbacks, zero when stalled, and keeps sampling a hidden statistics UI", async () => {
    const { view, video } = makeView();
    const listener = vi.fn();
    view.renderStatisticsHandler = listener;
    video.nextFrame();
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith({ source: "video", frameRate: 2, originalFrameRate: 2, interpolatedFrameRate: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ frameRate: 0 }));

    view.element.style.visibility = "hidden";
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ frameRate: 1 }));
    view.detach();
    expect(listener).toHaveBeenLastCalledWith(undefined);
    expect(video.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts only presented canvas originals and midpoints, not source callbacks or idle vsyncs", async () => {
    const { view, video } = makeView();
    const listener = vi.fn();
    view.renderStatisticsHandler = listener;
    let slot = 0;
    vi.spyOn(FrameInterpolationManager, "create").mockResolvedValue({
      capture: () => slot++ % 3,
      interpolate: async () => 3,
      present: vi.fn(), destroy: vi.fn(),
    } as unknown as FrameInterpolationManager);
    let tick: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { tick = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { tick = undefined; });
    view.setFrameInterpolation({ size: { width: 320, height: 180 }, onFailure: vi.fn() });
    video.nextFrame(0, 1);
    await vi.advanceTimersByTimeAsync(0);
    video.nextFrame(0.04, 2);
    await vi.advanceTimersByTimeAsync(40);
    video.nextFrame(0.08, 3);
    await vi.advanceTimersByTimeAsync(20);
    tick?.(performance.now());
    await vi.advanceTimersByTimeAsync(20);
    tick?.(performance.now());
    tick?.(performance.now());
    await vi.advanceTimersByTimeAsync(920);
    expect(listener).toHaveBeenLastCalledWith({ source: "canvas", frameRate: 3, originalFrameRate: 2, interpolatedFrameRate: 1 });

    view.setFrameInterpolation(undefined);
    video.nextFrame(0.12, 4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith({ source: "video", frameRate: 1, originalFrameRate: 1, interpolatedFrameRate: 0 });
    view.detach();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears old samples on source changes and ignores queued callbacks after detach", async () => {
    const { view, video } = makeView();
    const listener = vi.fn();
    view.renderStatisticsHandler = listener;
    video.nextFrame();
    view.setMediaStream({} as MediaStream);
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ frameRate: 0 }));
    const queued = [...video.callbacks.values()];
    view.detach();
    queued.forEach((callback) => callback());
    expect(video.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    view.attach(new ElementStub() as unknown as HTMLElement);
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ frameRate: 1 }));
    view.track = undefined;
    expect(listener).toHaveBeenLastCalledWith(undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not estimate unsupported frame callbacks from timers", () => {
    const { view } = makeView(false);
    const listener = vi.fn();
    view.renderStatisticsHandler = listener;
    expect(listener).toHaveBeenLastCalledWith(undefined);
    expect(vi.getTimerCount()).toBe(0);
    view.detach();
  });

  it("continues performance logs without a listener and isolates listener errors", async () => {
    XmaxLogger.configure(XmaxLoggerOption.performance);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { view, video } = makeView();
    view.renderStatisticsHandler = () => { throw new Error("consumer error"); };
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(log.mock.calls.flat().map(String).join(" ")).toContain("original: 1.0 fps, interpolated: 0.0 fps");
    view.renderStatisticsHandler = undefined;
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(log).toHaveBeenCalledTimes(2);
    view.detach();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("network video preview", () => {
  afterEach(() => vi.unstubAllGlobals());
  const options = {
    url: "https://example.com/video.mp4?signature=abc",
    videoFormat: new RealtimeVideoFormat({ width: 1920, height: 1024, fps: 30 }),
  };

  it("renders a muted URL directly without capture, keeps progress and releases all views", () => {
    const { view, video, onViewFrame } = makeView();
    const source = new NetworkVideoController();
    const stream = source.create(options, new MediaService());
    expect(source.reference).toEqual({ path: options.url, sampleMethod: RealtimeVideoSampleMethod.time });
    expect(stream.videoTrack?.mediaStreamTrack).toBeUndefined();
    view.track = stream.videoTrack;
    expect(video.src).toBe(options.url);
    expect(video.srcObject).toBeNull();
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(false);
    video.nextFrame();
    expect(onViewFrame).toHaveBeenCalledOnce();
    video.currentTime = 3;
    view.track = undefined;
    expect(video.src).toBe("");
    view.track = stream.videoTrack;
    video.currentTime = 0;
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(3);

    video.currentTime = 10;
    video.ended = true;
    view.track = undefined;
    view.track = stream.videoTrack;
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBeCloseTo(9.999);
    expect(video.autoplay).toBe(false);
    expect(video.paused).toBe(true);
    video.ended = false;
    view.detach();
    view.attach(new ElementStub() as unknown as HTMLElement);
    expect(video.play).not.toHaveBeenCalled();

    source.stop();
    expect(video.src).toBe("");
    expect(video.callbacks.size).toBe(0);
    expect(VideoRenderRegistry.binding(stream.videoTrack!)).toBeUndefined();
    expect(source.currentTrack).toBeUndefined();
    expect(source.reference).toBeUndefined();
    expect(source.onFinish).toBeUndefined();
    source.stop();
  });

  it("does not turn preview completion or playback errors into server completion", () => {
    const { view, video } = makeView();
    const source = new NetworkVideoController();
    const onFinish = vi.fn();
    const stream = source.create({ ...options, onFinish }, new MediaService());
    view.track = stream.videoTrack;
    video.dispatchEvent(new Event("ended"));
    video.dispatchEvent(new Event("error"));
    expect(onFinish).not.toHaveBeenCalled();
    expect(source.currentTrack).toBe(stream.videoTrack);
    source.stop();
  });

  it("pauses a detached URL preview and resumes when remounted", () => {
    const { view, video } = makeView();
    const source = new NetworkVideoController();
    view.track = source.create(options, new MediaService()).videoTrack;
    view.detach();
    expect(video.paused).toBe(true);
    view.attach(new ElementStub() as unknown as HTMLElement);
    expect(video.play).toHaveBeenCalledOnce();
    source.stop();
  });

  it.each(["/relative.mp4", "file:///test.mp4", "blob:https://example.com/id", "data:video/mp4,test", "ftp://example.com/v.mp4", "https://user:password@example.com/v.mp4", ""]) (
    "rejects unsupported source %s before creating a track", (url) => {
      const source = new NetworkVideoController();
      expect(() => source.create({ ...options, url }, new MediaService())).toThrow();
      expect(source.currentTrack).toBeUndefined();
    },
  );

  it("validates sampling and model dimensions", () => {
    const source = new NetworkVideoController();
    expect(() => source.create({ ...options, sampleMethod: "invalid" as RealtimeVideoSampleMethod }, new MediaService())).toThrow();
    expect(() => source.create({ ...options, videoFormat: new RealtimeVideoFormat({ width: 100, height: 100, fps: 30 }) }, new MediaService())).toThrow();
    expect(source.currentTrack).toBeUndefined();
  });
});

describe("XmaxVideoView first frame", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("支持帧回调时不把 playing 当成首帧，并同时保留视图与绑定回调", () => {
    const { video, onBindingFrame, onViewFrame } = makeView();
    video.dispatchEvent(new Event("playing"));
    expect(onBindingFrame).not.toHaveBeenCalled();
    expect(onViewFrame).not.toHaveBeenCalled();
    video.nextFrame();
    video.nextFrame();
    expect(onBindingFrame).toHaveBeenCalledTimes(1);
    expect(onViewFrame).toHaveBeenCalledTimes(1);
  });

  it("换流和清空后忽略已排队的旧首帧，新流可以重新通知", () => {
    const { view, video, onBindingFrame } = makeView();
    const oldFrame = [...video.callbacks.values()][0]!;
    view.setMediaStream({} as MediaStream);
    oldFrame();
    expect(onBindingFrame).not.toHaveBeenCalled();
    video.nextFrame();
    expect(onBindingFrame).toHaveBeenCalledTimes(1);

    view.setMediaStream({} as MediaStream);
    const pendingFrame = [...video.callbacks.values()][0]!;
    view.setMediaStream(null);
    expect(video.callbacks.size).toBe(0);
    pendingFrame();
    expect(onBindingFrame).toHaveBeenCalledTimes(1);
  });

  it("卸载取消待处理回调，重新挂载后继续等待首帧", () => {
    const { view, video, onBindingFrame } = makeView();
    const oldFrame = [...video.callbacks.values()][0]!;
    view.detach();
    expect(video.callbacks.size).toBe(0);
    oldFrame();
    expect(onBindingFrame).not.toHaveBeenCalled();
    view.attach(new ElementStub() as unknown as HTMLElement);
    expect(video.play).toHaveBeenCalledTimes(1);
    video.nextFrame();
    expect(onBindingFrame).toHaveBeenCalledTimes(1);
  });

  it("解绑轨道时不再通知该轨道的拥有者", () => {
    const { view, video, onBindingFrame } = makeView();
    const oldFrame = [...video.callbacks.values()][0]!;
    view.track = undefined;
    oldFrame();
    expect(video.callbacks.size).toBe(0);
    expect(video.srcObject).toBeNull();
    expect(onBindingFrame).not.toHaveBeenCalled();
  });

  it("旧浏览器通过 playing 回退，每条流只通知一次", () => {
    const { view, video, onBindingFrame, onViewFrame } = makeView(false);
    video.dispatchEvent(new Event("playing"));
    video.dispatchEvent(new Event("playing"));
    expect(onBindingFrame).toHaveBeenCalledTimes(1);
    expect(onViewFrame).toHaveBeenCalledTimes(1);
    view.setMediaStream({} as MediaStream);
    video.dispatchEvent(new Event("playing"));
    expect(onBindingFrame).toHaveBeenCalledTimes(2);
  });

  it("组合视图卸载时取消子视图回调，重新挂载恢复首帧通知和渐入", () => {
    const videos: VideoStub[] = [];
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag !== "video") return new ElementStub();
        const video = new VideoStub();
        videos.push(video);
        return video;
      },
    });
    const animate = vi.fn((callback: () => void) => { callback(); return 1; });
    vi.stubGlobal("requestAnimationFrame", animate);
    const localTrack = new RealtimeVideoTrack({ id: "local" });
    const remoteTrack = new RealtimeVideoTrack({ id: "remote" });
    const onFrame = vi.fn();
    for (const track of [localTrack, remoteTrack]) {
      VideoRenderRegistry.register(track, {
        attachHandler: (target) => target.setMediaStream({} as MediaStream),
        detachHandler: (target) => target.setMediaStream(null),
        frameDisplayHandler: onFrame,
      });
    }
    const view = new XmaxRealtimeVideoView({ localTrack, remoteTrack });
    const queued = videos.flatMap((video) => [...video.callbacks.values()]);
    view.detach();
    expect(videos.every((video) => video.callbacks.size === 0)).toBe(true);
    queued.forEach((callback) => callback());
    expect(onFrame).not.toHaveBeenCalled();
    view.attach(new ElementStub() as unknown as HTMLElement);
    videos.forEach((video) => video.nextFrame());
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(animate).toHaveBeenCalledTimes(1);
  });
});
