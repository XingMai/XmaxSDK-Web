import { describe, expect, it } from "vitest";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { MediaService } from "../src/Service/Media/MediaService";

describe("MediaService.resolveModelInputSize", () => {
  it("keeps the default camera format unchanged for x2.0", () => {
    const service = new MediaService(RealtimeModel.x2_0);
    const size = service.resolveModelInputSize({ width: 832, height: 1472 });
    expect(size).toEqual({ width: 832, height: 1472 });
  });

  it("scales down resolutions above the maximum pixel budget", () => {
    const service = new MediaService(RealtimeModel.x2_0);
    const size = service.resolveModelInputSize({ width: 1920, height: 1080 });
    expect(size.width % 32).toBe(0);
    expect(size.height % 32).toBe(0);
    expect(size.width * size.height).toBeLessThanOrEqual(1280000);
    expect(size.width * size.height).toBeGreaterThanOrEqual(600000);
  });

  it("scales up resolutions below the minimum pixel budget", () => {
    const service = new MediaService(RealtimeModel.x2_0);
    const size = service.resolveModelInputSize({ width: 640, height: 360 });
    expect(size.width % 32).toBe(0);
    expect(size.height % 32).toBe(0);
    expect(size.width * size.height).toBeGreaterThanOrEqual(600000);
  });

  it("accepts exact resolution bucket matches for x2.0-pro", () => {
    const service = new MediaService(RealtimeModel.x2_0_pro);
    expect(service.resolveModelInputSize({ width: 1024, height: 1920 })).toEqual({
      width: 1024,
      height: 1920,
    });
    expect(service.resolveModelInputSize({ width: 1920, height: 1024 })).toEqual({
      width: 1920,
      height: 1024,
    });
  });

  it("rejects non-bucket resolutions for x2.0-pro", () => {
    const service = new MediaService(RealtimeModel.x2_0_pro);
    try {
      service.resolveModelInputSize({ width: 832, height: 1472 });
      throw new Error("Expected XmaxError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(XmaxError);
      expect((error as XmaxError).code).toBe(XmaxErrorCode.invalidConfiguration);
    }
  });

  it("rejects invalid dimensions", () => {
    const service = new MediaService(RealtimeModel.x2_0);
    expect(() => service.resolveModelInputSize({ width: 0, height: 100 })).toThrow(
      XmaxError,
    );
  });
});
