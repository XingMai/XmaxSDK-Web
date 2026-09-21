import { afterEach, describe, expect, it, vi } from "vitest";
import { XmaxVideoView } from "../src/Render/Video/XmaxVideoView";
import { XmaxRealtimeVideoView } from "../src/Render/Video/XmaxRealtimeVideoView";
import { RealtimeVideoTrack } from "../src/Service/Realtime/RealtimeVideoTrack";
import { VideoRenderRegistry } from "../src/Service/Realtime/VideoRenderBinding";

class ElementStub extends EventTarget {
  style: Record<string, string> = {};
  appendChild(): void {}
  remove(): void {}
}

class VideoStub extends ElementStub {
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

  nextFrame(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback());
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
