import { describe, expect, it, vi } from "vitest";
import { qualityVideoFormat, supportsQualityEncoding } from "../src/Stream/Quality/QualityVideoFormat";
import { QUALITY_TIERS } from "../src/Stream/Quality/QualityTiers";
import { EncodingController } from "../src/Stream/Encoding/EncodingController";
import type { RtcManaging } from "../src/Foundation/RTC/RtcManaging";
import type { VideoEncodingConfiguration } from "../src/Foundation/RTC/VideoEncodingConfiguration";
import { RealtimeVideoFormat, RealtimeVideoEncoderPreference } from "../src/Service/Realtime/RealtimeVideoFormat";

describe("qualityVideoFormat", () => {
  it("provides direction-neutral named tiers in quality order", () => {
    expect(Object.keys(QUALITY_TIERS)).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(QUALITY_TIERS.L1).toEqual({ scale: 1, width: 1024, height: 1920, frameRate: 30 });
    expect(QUALITY_TIERS.L5).toEqual({ scale: 0.4, width: 408, height: 768, frameRate: 16 });
  });
  const portraitTiers = [
    [1024, 1920, 30], [818, 1536, 24], [664, 1248, 24], [512, 960, 20], [408, 768, 16],
  ];

  it.each([false, true])("matches all five tiers with landscape=%s", landscape => {
    const baseline = new RealtimeVideoFormat({ width: landscape ? 1920 : 1024, height: landscape ? 1024 : 1920, fps: 30 });
    portraitTiers.forEach(([width, height, fps], index) => {
      expect(qualityVideoFormat(baseline, index + 1)).toMatchObject({
        width: landscape ? height : width, height: landscape ? width : height, fps,
        minimumBitrate: undefined, maximumBitrate: undefined,
      });
    });
    expect(baseline.fps).toBe(30);
  });

  it("scales custom sources proportionally, rounds to even dimensions, and respects the source FPS ceiling", () => {
    const baseline = new RealtimeVideoFormat({ width: 1280, height: 720, fps: 20 });
    expect(qualityVideoFormat(baseline, 2)).toMatchObject({ width: 1024, height: 576, fps: 20 });
    expect(qualityVideoFormat(baseline, 5)).toMatchObject({ width: 512, height: 288, fps: 16 });
    const small = new RealtimeVideoFormat({ width: 642, height: 362, fps: 15 });
    for (let level = 1; level <= 5; level++) {
      const format = qualityVideoFormat(small, level);
      format.validate();
      expect(format.width % 2).toBe(0);
      expect(format.height % 2).toBe(0);
      expect(format.width).toBeLessThanOrEqual(small.width);
      expect(format.height).toBeLessThanOrEqual(small.height);
      expect(format.fps).toBe(15);
    }
  });

  it("recalculates default bitrate constraints per tier and restores the original defaults on recovery", async () => {
    const configureVideoEncoding = vi.fn(async (_config: VideoEncodingConfiguration) => {});
    const encoder = new EncodingController({ rtcManager: { configureVideoEncoding } as unknown as RtcManaging });
    const baseline = new RealtimeVideoFormat({ width: 1024, height: 1920, fps: 30 });
    for (let level = 1; level <= 5; level++) await encoder.configure(qualityVideoFormat(baseline, level));
    const configs = configureVideoEncoding.mock.calls.map(call => call[0]);
    for (let index = 1; index < configs.length; index++) {
      expect(configs[index]!.minimumBitrate).toBe(100);
      expect(configs[index]!.maximumBitrate).toBeLessThan(configs[index - 1]!.maximumBitrate);
    }
    await encoder.configure(qualityVideoFormat(baseline, 1));
    expect(configureVideoEncoding).toHaveBeenLastCalledWith(configs[0]);
  });

  it("retains explicit bitrate constraints and encoder preference", () => {
    const baseline = new RealtimeVideoFormat({ width: 1920, height: 1024, fps: 30,
      minimumBitrate: 0, maximumBitrate: 6000, encoderPreference: RealtimeVideoEncoderPreference.maintainQuality });
    expect(qualityVideoFormat(baseline, 5)).toMatchObject({ width: 768, height: 408, fps: 16,
      minimumBitrate: 0, maximumBitrate: 6000, encoderPreference: RealtimeVideoEncoderPreference.maintainQuality });
  });

  it("clamps the short side to 240 without enlarging smaller sources", () => {
    expect(qualityVideoFormat(new RealtimeVideoFormat({ width: 640, height: 360, fps: 30 }), 5))
      .toMatchObject({ width: 426, height: 240, fps: 16 });
    expect(qualityVideoFormat(new RealtimeVideoFormat({ width: 320, height: 180, fps: 30 }), 5))
      .toMatchObject({ width: 320, height: 180, fps: 16 });
  });

  it("detects explicit bitrate constraints incompatible with a lower tier", () => {
    const baseline = new RealtimeVideoFormat({ width: 1024, height: 1920, fps: 30, minimumBitrate: 3000 });
    expect(supportsQualityEncoding(qualityVideoFormat(baseline, 1))).toBe(true);
    expect(supportsQualityEncoding(qualityVideoFormat(baseline, 2))).toBe(false);
    expect(supportsQualityEncoding(new RealtimeVideoFormat({ ...baseline, minimumBitrate: undefined, maximumBitrate: 99 }))).toBe(false);
    expect(supportsQualityEncoding(new RealtimeVideoFormat({ ...baseline, minimumBitrate: 0, maximumBitrate: 99 }))).toBe(true);
  });

  it.each([0, 6, 1.5, NaN])("rejects invalid level %s", level => {
    expect(() => qualityVideoFormat(new RealtimeVideoFormat({ width: 1024, height: 1920, fps: 30 }), level)).toThrow();
  });
});
