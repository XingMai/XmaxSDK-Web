import { describe, expect, it } from "vitest";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import type { RtcManaging } from "../src/Foundation/RTC/RtcManaging";
import type { VideoEncodingConfiguration } from "../src/Foundation/RTC/VideoEncodingConfiguration";
import {
  RealtimeVideoEncoderPreference,
  RealtimeVideoFormat,
} from "../src/Service/Realtime/RealtimeVideoFormat";
import { EncodingController } from "../src/Stream/Encoding/EncodingController";

/** RTC 桩：记录编码配置，可注入失败。 */
class RtcManagingStub {
  encodingConfigurations: VideoEncodingConfiguration[] = [];
  encodingError?: XmaxError;

  async configureVideoEncoding(
    configuration: VideoEncodingConfiguration,
  ): Promise<void> {
    if (this.encodingError) {
      throw this.encodingError;
    }
    this.encodingConfigurations.push(configuration);
  }
}

function makeController() {
  const rtcManager = new RtcManagingStub();
  const controller = new EncodingController({
    rtcManager: rtcManager as unknown as RtcManaging,
  });
  return { controller, rtcManager };
}

function lastConfiguration(
  rtcManager: RtcManagingStub,
): VideoEncodingConfiguration {
  const configuration = rtcManager.encodingConfigurations.at(-1);
  if (!configuration) {
    throw new Error("expected an encoding configuration");
  }
  return configuration;
}

describe("EncodingController.updateFrameRate", () => {
  it("preserves resolved bitrates, size and preference through all four tiers", async () => {
    const { controller, rtcManager } = makeController();
    await controller.configure(new RealtimeVideoFormat({ width: 1920, height: 1024, fps: 30 }));
    const original = { ...lastConfiguration(rtcManager) };
    for (const fps of [24, 20, 16, 20, 24, 30]) {
      const result = await controller.updateFrameRate(fps);
      expect(lastConfiguration(rtcManager)).toEqual({ ...original, frameRate: fps });
      expect(result).toMatchObject({ width: 1920, height: 1024, fps,
        minimumBitrate: original.minimumBitrate, maximumBitrate: original.maximumBitrate });
    }
    const calls = rtcManager.encodingConfigurations.length;
    await controller.updateFrameRate(30);
    expect(rtcManager.encodingConfigurations).toHaveLength(calls);
  });

  it("requires a baseline, validates FPS, and does not commit failed changes", async () => {
    const { controller, rtcManager } = makeController();
    await expect(controller.updateFrameRate(24)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    await controller.configure(new RealtimeVideoFormat({ width: 1024, height: 1920, fps: 30,
      minimumBitrate: 0, maximumBitrate: 6000, encoderPreference: RealtimeVideoEncoderPreference.maintainQuality }));
    const original = { ...lastConfiguration(rtcManager) };
    for (const fps of [0, -1, NaN, Infinity]) {
      await expect(controller.updateFrameRate(fps)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    }
    rtcManager.encodingError = new XmaxError(XmaxErrorCode.rtcError, "failed");
    await expect(controller.updateFrameRate(24)).rejects.toBe(rtcManager.encodingError);
    await expect(controller.configure(new RealtimeVideoFormat({ width: 640, height: 360, fps: 16 }))).rejects.toBe(rtcManager.encodingError);
    rtcManager.encodingError = undefined;
    await controller.updateFrameRate(24);
    expect(lastConfiguration(rtcManager)).toEqual({ ...original, frameRate: 24 });
  });

  it("replaces the baseline when the caller explicitly applies a new full format", async () => {
    const { controller, rtcManager } = makeController();
    await controller.configure(new RealtimeVideoFormat({ width: 1920, height: 1024, fps: 30 }));
    await controller.configure(new RealtimeVideoFormat({ width: 640, height: 360, fps: 20, minimumBitrate: 0, maximumBitrate: 700 }));
    await controller.updateFrameRate(16);
    expect(lastConfiguration(rtcManager)).toMatchObject({ width: 640, height: 360, frameRate: 16, minimumBitrate: 0, maximumBitrate: 700 });
  });
});

describe("EncodingController.configure", () => {
  it("applies explicit bitrates and encoder preference", async () => {
    const { controller, rtcManager } = makeController();
    const cases: [
      number | undefined,
      number | undefined,
      RealtimeVideoEncoderPreference,
      number,
      number,
    ][] = [
      [1500, 3000, RealtimeVideoEncoderPreference.maintainFramerate, 1500, 3000],
      [0, 500, RealtimeVideoEncoderPreference.maintainQuality, 0, 500],
      [undefined, 4000, RealtimeVideoEncoderPreference.maintainFramerate, 100, 4000],
      [1500, undefined, RealtimeVideoEncoderPreference.maintainFramerate, 1500, 2166],
      [2000, 2000, RealtimeVideoEncoderPreference.maintainFramerate, 2000, 2000],
      [undefined, undefined, RealtimeVideoEncoderPreference.maintainQuality, 100, 2166],
    ];

    for (const [minimum, maximum, preference, expectedMinimum, expectedMaximum] of cases) {
      await controller.configure(
        new RealtimeVideoFormat({
          width: 832,
          height: 1472,
          fps: 24,
          minimumBitrate: minimum,
          maximumBitrate: maximum,
          encoderPreference: preference,
        }),
      );
      const configuration = lastConfiguration(rtcManager);
      expect(configuration.minimumBitrate).toBe(expectedMinimum);
      expect(configuration.maximumBitrate).toBe(expectedMaximum);
      expect(configuration.encoderPreference).toBe(preference);
      expect(configuration.width).toBe(832);
      expect(configuration.height).toBe(1472);
      expect(configuration.frameRate).toBe(24);
    }
  });

  it("rejects invalid explicit and merged bitrate ranges before RTC", async () => {
    const { controller, rtcManager } = makeController();
    const cases: [number | undefined, number | undefined][] = [
      [-1, undefined],
      [undefined, -1],
      [undefined, 0],
      [3000, 1500],
      [4000, undefined],
      [undefined, 99],
    ];

    for (const [minimum, maximum] of cases) {
      await expect(
        controller.configure(
          new RealtimeVideoFormat({
            width: 832,
            height: 1472,
            fps: 24,
            minimumBitrate: minimum,
            maximumBitrate: maximum,
          }),
        ),
      ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    }
    expect(rtcManager.encodingConfigurations).toHaveLength(0);
  });

  it("applies the default budget to every reference", async () => {
    const { controller, rtcManager } = makeController();
    const cases = [
      [160, 120, 15, 65, 130],
      [120, 120, 15, 50, 100],
      [320, 180, 15, 140, 280],
      [180, 180, 15, 100, 200],
      [240, 180, 15, 120, 240],
      [320, 240, 15, 200, 400],
      [240, 240, 15, 140, 280],
      [424, 240, 15, 220, 440],
      [640, 360, 15, 400, 800],
      [360, 360, 15, 260, 520],
      [640, 360, 30, 600, 1200],
      [360, 360, 30, 400, 800],
      [480, 360, 15, 320, 640],
      [480, 360, 30, 490, 980],
      [640, 480, 15, 500, 1000],
      [480, 480, 15, 400, 800],
      [640, 480, 30, 750, 1500],
      [480, 480, 30, 600, 1200],
      [848, 480, 15, 610, 1220],
      [848, 480, 30, 930, 1860],
      [640, 480, 10, 400, 800],
      [1280, 720, 15, 1130, 2260],
      [1280, 720, 30, 1710, 3420],
      [960, 720, 15, 910, 1820],
      [960, 720, 30, 1380, 2760],
      [1920, 1080, 15, 2080, 4160],
      [1920, 1080, 30, 3150, 6300],
      [1920, 1080, 60, 4780, 6500],
    ] as const;

    for (const [width, height, fps, , maximum] of cases) {
      await controller.configure(new RealtimeVideoFormat({ width, height, fps }));
      const configuration = lastConfiguration(rtcManager);
      expect(configuration.minimumBitrate).toBe(100);
      expect(configuration.maximumBitrate).toBe(Math.max(100, Math.round(maximum * 0.6)));
    }
  });

  it("interpolates and extrapolates upload bitrate", async () => {
    const { controller, rtcManager } = makeController();
    const cases = [
      [1920, 1080, 24, 100, 3266],
      [832, 1472, 24, 100, 2166],
      [1472, 832, 24, 100, 2166],
      [1024, 1920, 30, 100, 3619],
      [1024, 1920, 24, 100, 3127],
      [1024, 768, 30, 100, 1820],
      [1024, 768, 24, 100, 1572],
      [1920, 1080, 120, 100, 7800],
      [3840, 2160, 30, 100, 15120],
      [120, 120, 30, 100, 100],
      [1920, 1080, 1, 100, 200],
      [2, 2, 1, 100, 100],
    ] as const;

    for (const [width, height, fps, , maximum] of cases) {
      await controller.configure(new RealtimeVideoFormat({ width, height, fps }));
      const configuration = lastConfiguration(rtcManager);
      expect(configuration.minimumBitrate).toBe(100);
      expect(configuration.maximumBitrate).toBe(maximum);
    }
  });

  it("keeps bitrate ordered and monotonic across frame rates", async () => {
    const { controller, rtcManager } = makeController();
    const sizes = [
      [120, 120],
      [320, 240],
      [832, 1472],
      [1920, 1080],
      [3840, 2160],
    ] as const;
    const frameRates = [1, 9, 10, 11, 14, 15, 16, 24, 29, 30, 31, 59, 60, 61, 120];

    for (const [width, height] of sizes) {
      let previousMinimum = 0;
      let previousMaximum = 0;
      for (const fps of frameRates) {
        await controller.configure(new RealtimeVideoFormat({ width, height, fps }));
        const configuration = lastConfiguration(rtcManager);
        expect(configuration.minimumBitrate).toBeGreaterThan(0);
        expect(configuration.maximumBitrate).toBeGreaterThanOrEqual(
          configuration.minimumBitrate,
        );
        expect(configuration.minimumBitrate).toBeGreaterThanOrEqual(previousMinimum);
        expect(configuration.maximumBitrate).toBeGreaterThanOrEqual(previousMaximum);
        previousMinimum = configuration.minimumBitrate;
        previousMaximum = configuration.maximumBitrate;
      }
    }
  });

  it("rejects bitrate overflow before calling RTC", async () => {
    const { controller, rtcManager } = makeController();

    await expect(
      controller.configure(
        new RealtimeVideoFormat({ width: 1024, height: 768, fps: 1e308 }),
      ),
    ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(rtcManager.encodingConfigurations).toHaveLength(0);
  });

  it("rejects invalid format before calling RTC", async () => {
    const { controller, rtcManager } = makeController();

    await expect(
      controller.configure(
        new RealtimeVideoFormat({ width: 1023, height: 768, fps: 30 }),
      ),
    ).rejects.toMatchObject({
      code: XmaxErrorCode.invalidConfiguration,
      message:
        "Realtime video width and height must be positive " +
        "even numbers, and fps must be greater than zero",
    });
    expect(rtcManager.encodingConfigurations).toHaveLength(0);
  });

  it("preserves RTC errors", async () => {
    const { controller } = makeController();
    const expectedError = new XmaxError(
      XmaxErrorCode.rtcError,
      "Failed to configure RTC encoding",
    );
    const rtcManager = new RtcManagingStub();
    rtcManager.encodingError = expectedError;
    const failingController = new EncodingController({
      rtcManager: rtcManager as unknown as RtcManaging,
    });
    void controller;

    await expect(
      failingController.configure(
        new RealtimeVideoFormat({ width: 1024, height: 768, fps: 30 }),
      ),
    ).rejects.toBe(expectedError);
  });
});
