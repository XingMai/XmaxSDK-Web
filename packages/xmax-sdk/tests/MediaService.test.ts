import { describe, expect, it } from "vitest";
import { defaultCameraVideoFormat, RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { MediaService } from "../src/Service/Media/MediaService";

describe("MediaService.resolveModelInputSize", () => {
  it.each([
    [RealtimeModel.x2_0, 832, 1472],
    [RealtimeModel.x2_0_pro, 1024, 1920],
    [RealtimeModel.x2_0_trtc, 1024, 1920],
  ] as const)("keeps the default camera format unchanged for %s", (model, width, height) => {
    const service = new MediaService(model);
    const format = defaultCameraVideoFormat(model);

    expect(format).toMatchObject({ width, height, fps: 30 });
    expect(service.resolveModelInputSize(format)).toEqual({ width, height });
  });

  it.each([RealtimeModel.x2_0_pro, RealtimeModel.x2_0_trtc])("accepts exact resolution bucket matches for %s", (model) => {
    const service = new MediaService(model);
    expect(service.resolveModelInputSize({ width: 1024, height: 1920 })).toEqual({
      width: 1024,
      height: 1920,
    });
    expect(service.resolveModelInputSize({ width: 1920, height: 1024 })).toEqual({
      width: 1920,
      height: 1024,
    });
  });

  it.each([RealtimeModel.x2_0_pro, RealtimeModel.x2_0_trtc])("rejects non-bucket resolutions for %s", (model) => {
    const service = new MediaService(model);
    try {
      service.resolveModelInputSize({ width: 832, height: 1472 });
      throw new Error("Expected XmaxError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(XmaxError);
      expect((error as XmaxError).code).toBe(XmaxErrorCode.invalidConfiguration);
    }
  });

  it.each(Object.values(RealtimeModel))("rejects invalid dimensions for %s", (model) => {
    const service = new MediaService(model);
    expect(() => service.resolveModelInputSize({ width: 0, height: 100 })).toThrow(
      XmaxError,
    );
  });

  it.each([
    { width: 1920, height: 1024 },
    { width: 1024, height: 1920 },
    { width: 1920, height: 1080 },
    { width: 640, height: 360 },
    { width: 360, height: 640 },
  ])("scales x2.0 input $width × $height to the aligned pixel budget", (input) => {
    const size = new MediaService(RealtimeModel.x2_0).resolveModelInputSize(input);

    expect(size.width % 32).toBe(0);
    expect(size.height % 32).toBe(0);
    expect(size.width * size.height).toBeGreaterThanOrEqual(600000);
    expect(size.width * size.height).toBeLessThanOrEqual(1280000);
    expect(size.width / size.height).toBeCloseTo(input.width / input.height, 1);
  });

  it("keeps the fast model as the default media service model", () => {
    expect(new MediaService().model).toBe(RealtimeModel.x2_0_trtc);
  });
});
