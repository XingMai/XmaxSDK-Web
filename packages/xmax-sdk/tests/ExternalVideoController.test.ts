import { describe, expect, it, vi } from "vitest";
import { ExternalVideoController } from "../src/Media/Video/ExternalVideoController";
import { MediaService } from "../src/Service/Media/MediaService";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";

class VideoTrack extends EventTarget {
  kind = "video";
  readyState = "live";
  stop = vi.fn(() => { this.readyState = "ended"; });
  clone = vi.fn((): VideoTrack => new VideoTrack());
}

const videoFormat = new RealtimeVideoFormat({ width: 1024, height: 1920, fps: 30 });
const media = new MediaService();

describe("ExternalVideoController", () => {
  it("owns only a clone, requires no DOM or preview, and removes ended listeners on stop", () => {
    const source = new VideoTrack();
    const onError = vi.fn();
    const controller = new ExternalVideoController(onError);
    const stream = controller.create({ videoTrack: source as unknown as MediaStreamTrack, videoFormat }, media);
    const clone = source.clone.mock.results[0]!.value;
    expect(stream.videoTrack?.mediaStreamTrack).toBe(clone);
    expect(stream.videoTrack?.videoFormat).toEqual(videoFormat);
    expect(controller.currentTrack).toBe(stream.videoTrack);
    clone.dispatchEvent(new Event("ended"));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "External video source ended" }));
    controller.stop();
    controller.stop();
    expect(clone.stop).toHaveBeenCalledOnce();
    expect(source.stop).not.toHaveBeenCalled();
    expect(controller.currentTrack).toBeUndefined();
    clone.dispatchEvent(new Event("ended"));
    expect(onError).toHaveBeenCalledOnce();
  });

  it.each(["audio", "ended"])("rejects %s inputs without cloning", invalid => {
    const source = new VideoTrack();
    if (invalid === "audio") source.kind = "audio";
    else source.readyState = "ended";
    const controller = new ExternalVideoController(vi.fn());
    expect(() => controller.create({ videoTrack: source as unknown as MediaStreamTrack, videoFormat }, media)).toThrow("live video");
    expect(source.clone).not.toHaveBeenCalled();
  });

  it("validates format and model dimensions before acquiring a clone", () => {
    const source = new VideoTrack();
    const controller = new ExternalVideoController(vi.fn());
    for (const format of [new RealtimeVideoFormat({ ...videoFormat, fps: 0 }), new RealtimeVideoFormat({ ...videoFormat, width: 640 })]) {
      expect(() => controller.create({ videoTrack: source as unknown as MediaStreamTrack, videoFormat: format }, media)).toThrow();
    }
    expect(source.clone).not.toHaveBeenCalled();
  });

  it("rejects duplicate sources and releases a clone that ended during setup", () => {
    const source = new VideoTrack();
    const controller = new ExternalVideoController(vi.fn());
    const options = { videoTrack: source as unknown as MediaStreamTrack, videoFormat };
    controller.create(options, media);
    expect(() => controller.create(options, media)).toThrow("Close the current");
    controller.stop();
    const ended = new VideoTrack();
    ended.readyState = "ended";
    source.clone.mockReturnValueOnce(ended);
    expect(() => controller.create(options, media)).toThrow("ended during setup");
    expect(ended.stop).toHaveBeenCalledOnce();
    expect(source.stop).not.toHaveBeenCalled();
    expect(controller.currentTrack).toBeUndefined();
  });
});
