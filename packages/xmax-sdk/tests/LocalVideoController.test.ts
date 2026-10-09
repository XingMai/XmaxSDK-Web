import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalVideoController } from "../src/Media/Video/LocalVideoController";
import { MediaService } from "../src/Service/Media/MediaService";
import { RealtimeVideoFormat, RealtimeVideoEncoderPreference } from "../src/Service/Realtime/RealtimeVideoFormat";
import { RealtimeModel, resolutionBuckets } from "../src/Service/Realtime/RealtimeModel";
import { VideoRenderRegistry } from "../src/Service/Realtime/VideoRenderBinding";
import { VideoContentMode } from "../src/Foundation/Media/Video/VideoContentMode";

class Video extends EventTarget {
  src = "";
  muted = false;
  loop = false;
  paused = true;
  readyState = 2;
  videoWidth = 640;
  videoHeight = 360;
  duration = 10;
  private time = 0;
  get currentTime() { return this.time; }
  set currentTime(time: number) {
    this.time = time;
    Promise.resolve().then(() => this.dispatchEvent(new Event("seeked")));
  }
  play = vi.fn(async () => { this.paused = false; this.currentTime = 0.1; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute = vi.fn(() => { this.src = ""; });
}

function setup() {
  const video = new Video();
  const videoTrack = { kind: "video", readyState: "live", stop: vi.fn() };
  const audioTrack = { kind: "audio", readyState: "live", stop: vi.fn() };
  const stream = { getVideoTracks: () => [videoTrack], getTracks: () => [videoTrack] };
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => context, captureStream: vi.fn(() => stream) };
  const audioSource = { connect: vi.fn(), disconnect: vi.fn() };
  const audioDestination = { stream: { getAudioTracks: () => [audioTrack], getTracks: () => [audioTrack] }, disconnect: vi.fn() };
  const audio = {
    createMediaElementSource: vi.fn(() => audioSource),
    createMediaStreamDestination: vi.fn(() => audioDestination),
    resume: vi.fn(async () => {}), close: vi.fn(async () => {}), destination: {},
  };
  const audioFactory = vi.fn(function () { return audio; });
  vi.stubGlobal("AudioContext", audioFactory);
  vi.stubGlobal("document", { createElement: (tag: string) => tag === "video" ? video : canvas });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-test");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const onError = vi.fn();
  const controller = new LocalVideoController(onError);
  controllers.push(controller);
  const signal = new AbortController();
  return { controller, video, videoTrack, audioTrack, stream, canvas, context, audio, audioFactory, audioSource, audioDestination, revoke, onError, signal };
}

const controllers: LocalVideoController[] = [];
const options = {
  file: new Blob(["video fixture"]),
  videoFormat: new RealtimeVideoFormat({ width: 1920, height: 1024, fps: 30 }),
};
const media = new MediaService();
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const controller of controllers.splice(0)) {
    await controller.stop();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LocalVideoController", () => {
  it.each([
    [1280, 720, 1920, 1024],
    [720, 1280, 1024, 1920],
    [1080, 1080, 1920, 1024],
    [1920, 1024, 1920, 1024],
    [1024, 1920, 1024, 1920],
    [3840, 2160, 1920, 1024],
    [640, 480, 1920, 1024],
  ])("fits requested %s×%s into %s×%s and preserves encoding options", async (width, height, targetWidth, targetHeight) => {
    const s = setup();
    s.video.videoWidth = width;
    s.video.videoHeight = height;
    const videoFormat = new RealtimeVideoFormat({
      width, height, fps: 24, minimumBitrate: 1000, maximumBitrate: 4000,
      encoderPreference: RealtimeVideoEncoderPreference.maintainQuality,
    });
    const bucketsBefore = resolutionBuckets(media.model).map(size => ({ ...size }));
    const local = await s.controller.create({ ...options, videoFormat }, media, s.signal.signal);
    expect(local.videoTrack?.videoFormat).toEqual(videoFormat.resized(targetWidth, targetHeight));
    expect(s.canvas.width).toBe(targetWidth);
    expect(s.canvas.height).toBe(targetHeight);
    expect(s.canvas.captureStream).toHaveBeenCalledWith(24);
    const scale = Math.min(targetWidth / width, targetHeight / height);
    expect(s.context.drawImage).toHaveBeenLastCalledWith(
      s.video, (targetWidth - width * scale) / 2, (targetHeight - height * scale) / 2, width * scale, height * scale,
    );
    expect(videoFormat.width).toBe(width);
    expect(videoFormat.height).toBe(height);
    expect(resolutionBuckets(media.model)).toEqual(bucketsBefore);
  });

  it.each([RealtimeModel.x2_0_agora, RealtimeModel.x2_1_preview, "custom-model"])("uses the resolution buckets for %s", async (model) => {
    const s = setup();
    const local = await s.controller.create({
      ...options, videoFormat: new RealtimeVideoFormat({ width: 1280, height: 720, fps: 30 }),
    }, new MediaService(model), s.signal.signal);
    expect(local.videoTrack?.videoFormat).toMatchObject({ width: 1920, height: 1024 });
  });

  it("keeps pixel-budget sizing for models without fixed resolutions", async () => {
    const s = setup(), flexibleMedia = new MediaService(RealtimeModel.x2_0);
    const videoFormat = new RealtimeVideoFormat({ width: 3840, height: 2160, fps: 30 });
    const expected = flexibleMedia.resolveModelInputSize(videoFormat);
    const local = await s.controller.create({ ...options, videoFormat }, flexibleMedia, s.signal.signal);
    expect(local.videoTrack?.videoFormat).toMatchObject(expected);
    expect(s.canvas.width).toBe(expected.width);
    expect(s.canvas.height).toBe(expected.height);
  });

  it("prepares first frame, routes file audio only to RTC, letterboxes and releases all resources", async () => {
    const s = setup();
    const local = await s.controller.create(options, media, s.signal.signal);
    expect(s.video.paused).toBe(true);
    expect(s.video.loop).toBe(true);
    expect(s.video.currentTime).toBe(0);
    expect(s.canvas.captureStream).toHaveBeenCalledWith(30);
    expect(s.canvas.width).toBe(1920);
    expect(s.context.drawImage).toHaveBeenLastCalledWith(s.video, expect.closeTo(49.7778, 2), 0, expect.closeTo(1820.4444, 2), 1024);
    expect(s.audioSource.connect).toHaveBeenCalledOnce();
    expect(s.audioSource.connect).toHaveBeenCalledWith(s.audioDestination);
    expect(s.video.muted).toBe(false);
    expect(s.controller.audioTrack).toBe(s.audioTrack);
    expect(local.videoTrack?.mediaStreamTrack).toBe(s.videoTrack);

    const view = { isMirrored: true, setMediaStream: vi.fn() };
    VideoRenderRegistry.binding(local.videoTrack!)!.attachHandler(view, VideoContentMode.fit);
    expect(view.setMediaStream).toHaveBeenCalledWith(s.stream);
    expect(view.isMirrored).toBe(false);
    await s.controller.start(s.signal.signal);
    expect(s.video.paused).toBe(false);
    s.video.currentTime = 10;
    s.video.dispatchEvent(new Event("ended"));
    expect(s.onError).not.toHaveBeenCalled();
    expect(s.controller.isActive).toBe(true);
    s.controller.pause();
    expect(s.video.paused).toBe(true);

    await s.controller.stop();
    expect(s.videoTrack.stop).toHaveBeenCalledOnce();
    expect(s.audioTrack.stop).toHaveBeenCalledOnce();
    expect(s.audio.close).toHaveBeenCalledOnce();
    expect(s.audioSource.disconnect).toHaveBeenCalledOnce();
    expect(s.revoke).toHaveBeenCalledWith("blob:local-test");
    expect(view.setMediaStream).toHaveBeenLastCalledWith(null);
    expect(VideoRenderRegistry.binding(local.videoTrack!)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])("preserves loop=%s through playback and restart", async (loop) => {
    const s = setup();
    await s.controller.create({ ...options, loop }, media, s.signal.signal);
    expect(s.video.loop).toBe(loop);
    expect(s.video.paused).toBe(true);

    await s.controller.start(s.signal.signal);
    expect(s.video.loop).toBe(loop);
    s.controller.pause();
    await s.controller.start(s.signal.signal);
    expect(s.video.loop).toBe(loop);
  });

  it("does not create an audio context when file audio is disabled", async () => {
    const s = setup();
    await s.controller.create({ ...options, includeAudio: false }, media, s.signal.signal);
    expect(s.audioFactory).not.toHaveBeenCalled();
    expect(s.controller.audioTrack).toBeUndefined();
    expect(s.video.muted).toBe(true);
  });

  it("rewinds on a new start rather than resuming an old task midway", async () => {
    const s = setup();
    await s.controller.create(options, media, s.signal.signal);
    s.video.currentTime = 5;
    s.video.play.mockImplementation(async () => {
      expect(s.video.currentTime).toBe(0);
      s.video.paused = false;
    });
    await s.controller.start(s.signal.signal);
    expect(s.video.play).toHaveBeenCalledTimes(2);
  });

  it("cleans up unsupported files and rejected autoplay before publishing", async () => {
    const s = setup();
    s.video.play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    await expect(s.controller.create(options, media, s.signal.signal)).rejects.toMatchObject({ code: "MEDIA_ERROR" });
    expect(s.controller.isActive).toBe(false);
    expect(s.revoke).toHaveBeenCalledOnce();
    expect(s.audio.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a suspended audio context instead of hanging forever", async () => {
    const s = setup();
    s.audio.resume.mockReturnValueOnce(new Promise(() => {}));
    const created = s.controller.create(options, media, s.signal.signal);
    const rejected = expect(created).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(s.audio.close).toHaveBeenCalledOnce();
    expect(s.controller.currentTrack).toBeUndefined();
  });

  it("cancels preparation and stops a late play resolution", async () => {
    const s = setup();
    let finish!: () => void;
    s.video.play.mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { s.video.paused = false; resolve(); }; }));
    const created = s.controller.create(options, media, s.signal.signal);
    const rejected = expect(created).rejects.toMatchObject({ code: "CANCELLED" });
    s.signal.abort();
    await rejected;
    finish();
    await Promise.resolve();
    expect(s.video.paused).toBe(true);
    expect(s.controller.currentTrack).toBeUndefined();
  });

  it("cancels late playback on disconnect while preserving the prepared source", async () => {
    const s = setup();
    await s.controller.create(options, media, s.signal.signal);
    let finish!: () => void;
    s.video.play.mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { s.video.paused = false; resolve(); }; }));
    const starting = s.controller.start(s.signal.signal);
    const rejected = expect(starting).rejects.toMatchObject({ code: "CANCELLED" });
    await Promise.resolve();
    s.signal.abort();
    await rejected;
    finish();
    await Promise.resolve();
    expect(s.video.paused).toBe(true);
    expect(s.controller.currentTrack).toBeDefined();
  });

  it("reports runtime decode failure once and stops drawing", async () => {
    const s = setup();
    await s.controller.create(options, media, s.signal.signal);
    s.video.dispatchEvent(new Event("error"));
    s.video.dispatchEvent(new Event("error"));
    expect(s.onError).toHaveBeenCalledOnce();
    expect(s.video.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("validates source and format before allocating media resources", async () => {
    const s = setup();
    await expect(s.controller.create({ ...options, file: new Blob() }, media, s.signal.signal)).rejects.toThrow();
    await expect(s.controller.create({ ...options, videoFormat: new RealtimeVideoFormat({ width: 1, height: 1, fps: 30 }) }, media, s.signal.signal)).rejects.toThrow();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(s.audioFactory).not.toHaveBeenCalled();
  });
});
