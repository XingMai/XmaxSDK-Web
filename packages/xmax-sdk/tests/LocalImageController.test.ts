import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalImageController } from "../src/Media/Image/LocalImageController";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { MediaService } from "../src/Service/Media/MediaService";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { VideoRenderRegistry } from "../src/Service/Realtime/VideoRenderBinding";
import { VideoContentMode } from "../src/Foundation/Media/Video/VideoContentMode";

class ImageStub extends EventTarget {
  naturalWidth = 640;
  naturalHeight = 360;
  loadEvent = "load";
  set src(_value: string) {
    if (this.loadEvent) {
      Promise.resolve().then(() => this.dispatchEvent(new Event(this.loadEvent)));
    }
  }
  removeAttribute = vi.fn();
}

const controllers: LocalImageController[] = [];
const options = {
  file: new Blob(["image fixture"], { type: "image/png" }),
  videoFormat: new RealtimeVideoFormat({ width: 1280, height: 720, fps: 30 }),
};

function setup() {
  const image = new ImageStub();
  const native = Object.assign(new EventTarget(), { readyState: "live", stop: vi.fn(), requestFrame: vi.fn() });
  const stream = { getVideoTracks: () => [native], getTracks: () => [native] };
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, captureStream: vi.fn(() => stream), getContext: vi.fn(() => context) };
  vi.stubGlobal("document", { createElement: (tag: string) => tag === "img" ? image : canvas });
  const objectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const onError = vi.fn();
  const controller = new LocalImageController(onError);
  controllers.push(controller);
  const signal = new AbortController();
  const create = (overrides = {}) => controller.create({ ...options, ...overrides }, new MediaService(), signal.signal);
  return { image, native, stream, context, canvas, objectURL, revoke, onError, controller, signal, create };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const controller of controllers.splice(0)) {
    controller.stop();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LocalImageController", () => {
  it.each([[1280, 720, 1920, 1024], [720, 1280, 1024, 1920], [600, 600, 1920, 1024]])(
    "fits %s×%s to %s×%s, freezes the image and releases preview resources",
    async (width, height, targetWidth, targetHeight) => {
      const s = setup();
      s.image.naturalWidth = width;
      s.image.naturalHeight = height;
      const format = new RealtimeVideoFormat({ width, height, fps: 24, maximumBitrate: 4000 });
      const local = await s.create({ videoFormat: format });
      expect(local.videoTrack?.videoFormat).toEqual(format.resized(targetWidth, targetHeight));
      expect(s.canvas.captureStream).toHaveBeenCalledWith(24);
      const scale = Math.min(targetWidth / width, targetHeight / height);
      expect(s.context.drawImage).toHaveBeenNthCalledWith(1, s.image,
        (targetWidth - width * scale) / 2, (targetHeight - height * scale) / 2, width * scale, height * scale);
      expect(s.context.fillStyle).toBe("black");
      expect(local.videoTrack?.mediaStreamTrack).toBe(s.native);
      const view = { isMirrored: true, setMediaStream: vi.fn() };
      const binding = VideoRenderRegistry.binding(local.videoTrack!)!;
      binding.attachHandler(view, VideoContentMode.fit);
      expect(view.isMirrored).toBe(false);
      expect(view.setMediaStream).toHaveBeenCalledWith(s.stream);

      await vi.advanceTimersByTimeAsync(150);
      expect(s.native.requestFrame.mock.calls.length).toBeGreaterThan(1);
      expect(s.context.drawImage.mock.calls.filter(call => call[0] === s.image)).toHaveLength(1);
      expect(s.context.drawImage).toHaveBeenLastCalledWith(s.canvas, 0, 0);
      s.controller.stop();
      s.controller.stop();
      expect(s.native.stop).toHaveBeenCalledOnce();
      expect(s.revoke).toHaveBeenCalledWith("blob:image");
      expect(view.setMediaStream).toHaveBeenLastCalledWith(null);
      expect(VideoRenderRegistry.binding(local.videoTrack!)).toBeUndefined();
      expect(local.videoTrack?.mediaStreamTrack).toBeUndefined();
      expect(s.controller.isActive).toBe(false);
      expect(s.canvas.width).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      view.setMediaStream.mockClear();
      binding.attachHandler(view, VideoContentMode.fit);
      expect(view.setMediaStream).not.toHaveBeenCalled();
    },
  );

  it("preserves flexible model sizing and does not change camera sizing rules", async () => {
    const s = setup();
    const media = new MediaService(RealtimeModel.x2_0);
    const local = await s.controller.create(options, media, s.signal.signal);
    expect(local.videoTrack?.videoFormat).toEqual(options.videoFormat.resized(
      media.resolveModelInputSize(options.videoFormat).width,
      media.resolveModelInputSize(options.videoFormat).height,
    ));
    expect(() => new MediaService().resolveModelInputSize(options.videoFormat)).toThrow("does not support input resolution");
  });

  it("refreshes the snapshot without requestFrame support", async () => {
    const s = setup();
    Object.assign(s.native, { requestFrame: undefined });
    await s.create();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.context.drawImage.mock.calls.length).toBeGreaterThan(2);
    expect(s.onError).not.toHaveBeenCalled();
  });

  it.each([new Blob([]), null])("rejects invalid file %s without resources", async file => {
    const s = setup();
    await expect(s.create({ file })).rejects.toThrow("non-empty File or Blob");
    expect(s.objectURL).not.toHaveBeenCalled();
  });

  it("rejects invalid format and pre-cancelled creation before decoding", async () => {
    const s = setup();
    await expect(s.create({ videoFormat: new RealtimeVideoFormat({ width: 0, height: 720, fps: 30 }) })).rejects.toThrow();
    s.signal.abort();
    await expect(s.create()).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(s.objectURL).not.toHaveBeenCalled();
  });

  it.each(["error", "dimensions", "capture", "draw"])("cleans up preparation failure: %s", async failure => {
    const s = setup();
    if (failure === "error") s.image.loadEvent = "error";
    if (failure === "dimensions") s.image.naturalWidth = 0;
    if (failure === "capture") s.native.readyState = "ended";
    if (failure === "draw") s.context.drawImage.mockImplementation(() => { throw new Error("draw"); });
    await expect(s.create()).rejects.toThrow();
    expect(s.controller.isActive).toBe(false);
    expect(s.revoke).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    if (failure === "capture") expect(s.native.stop).toHaveBeenCalledOnce();
  });

  it.each(["abort", "stop", "timeout"])("cancels pending decode on %s", async action => {
    const s = setup();
    s.image.loadEvent = "";
    const creating = s.create();
    const rejected = expect(creating).rejects.toMatchObject({ code: action === "timeout" ? XmaxErrorCode.timeout : XmaxErrorCode.cancelled });
    expect(s.controller.isActive).toBe(true);
    await expect(s.create()).rejects.toThrow("Close the current local image");
    if (action === "abort") s.signal.abort();
    if (action === "stop") s.controller.stop();
    if (action === "timeout") await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(s.controller.isActive).toBe(false);
    expect(s.revoke).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a cancelled decode tear down a newly created source", async () => {
    const s = setup();
    s.image.loadEvent = "";
    const first = s.create();
    const rejected = expect(first).rejects.toThrow("cancelled");
    s.controller.stop();
    s.image.loadEvent = "load";
    const second = s.create();
    await rejected;
    await second;
    expect(s.controller.currentTrack).toBeDefined();
    expect(s.controller.isActive).toBe(true);
  });

  it.each(["ended", "draw"])("reports runtime %s failure once and stops refreshing", async failure => {
    const s = setup();
    await s.create();
    if (failure === "ended") {
      s.native.dispatchEvent(new Event("ended"));
      s.native.dispatchEvent(new Event("ended"));
    } else {
      s.context.drawImage.mockImplementation(() => { throw new Error("draw"); });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(s.onError).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    s.controller.stop();
    s.native.dispatchEvent(new Event("ended"));
    expect(s.onError).toHaveBeenCalledOnce();
  });

  it("releases output even when a preview throws during detach", async () => {
    const s = setup();
    const local = await s.create();
    const view = { isMirrored: false, setMediaStream: vi.fn() };
    VideoRenderRegistry.binding(local.videoTrack!)!.attachHandler(view, VideoContentMode.fill);
    view.setMediaStream.mockImplementation(() => { throw new Error("view"); });
    expect(() => s.controller.stop()).not.toThrow();
    expect(s.native.stop).toHaveBeenCalledOnce();
    expect(s.revoke).toHaveBeenCalledOnce();
  });
});
