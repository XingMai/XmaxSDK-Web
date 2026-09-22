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
      [undefined, 4000, RealtimeVideoEncoderPreference.maintainFramerate, 1805, 4000],
      [1500, undefined, RealtimeVideoEncoderPreference.maintainFramerate, 1500, 3611],
      [2000, 2000, RealtimeVideoEncoderPreference.maintainFramerate, 2000, 2000],
      [undefined, undefined, RealtimeVideoEncoderPreference.maintainQuality, 1805, 3611],
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
      [undefined, 1000],
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

  it("matches every official reference", async () => {
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

    for (const [width, height, fps, minimum, maximum] of cases) {
      await controller.configure(new RealtimeVideoFormat({ width, height, fps }));
      const configuration = lastConfiguration(rtcManager);
      expect(configuration.minimumBitrate).toBe(minimum);
      expect(configuration.maximumBitrate).toBe(maximum);
    }
  });

  it("interpolates and extrapolates upload bitrate", async () => {
    const { controller, rtcManager } = makeController();
    const cases = [
      [1920, 1080, 24, 2722, 5444],
      [832, 1472, 24, 1805, 3611],
      [1472, 832, 24, 1805, 3611],
      [1024, 1920, 30, 3016, 6031],
      [1024, 1920, 24, 2606, 5212],
      [1024, 768, 30, 1516, 3033],
      [1024, 768, 24, 1310, 2620],
      [1920, 1080, 120, 9560, 13000],
      [3840, 2160, 30, 12600, 25200],
      [120, 120, 30, 77, 154],
      [1920, 1080, 1, 166, 333],
      [2, 2, 1, 1, 2],
    ] as const;

    for (const [width, height, fps, minimum, maximum] of cases) {
      await controller.configure(new RealtimeVideoFormat({ width, height, fps }));
      const configuration = lastConfiguration(rtcManager);
      expect(configuration.minimumBitrate).toBe(minimum);
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
        expect(configuration.maximumBitrate).toBeGreaterThan(
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
