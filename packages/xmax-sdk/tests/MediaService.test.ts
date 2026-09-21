import { describe, expect, it } from "vitest";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { MediaService } from "../src/Service/Media/MediaService";

describe("MediaService.resolveModelInputSize", () => {
  it("keeps the default camera format unchanged", () => {
    const service = new MediaService(RealtimeModel.x2_fast_1080p);
    const size = service.resolveModelInputSize({ width: 1024, height: 1920 });
    expect(size).toEqual({ width: 1024, height: 1920 });
  });

  it("accepts exact resolution bucket matches", () => {
    const service = new MediaService(RealtimeModel.x2_fast_1080p);
    expect(service.resolveModelInputSize({ width: 1024, height: 1920 })).toEqual({
      width: 1024,
      height: 1920,
    });
    expect(service.resolveModelInputSize({ width: 1920, height: 1024 })).toEqual({
      width: 1920,
      height: 1024,
    });
  });

  it("rejects non-bucket resolutions", () => {
    const service = new MediaService(RealtimeModel.x2_fast_1080p);
    try {
      service.resolveModelInputSize({ width: 832, height: 1472 });
      throw new Error("Expected XmaxError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(XmaxError);
      expect((error as XmaxError).code).toBe(XmaxErrorCode.invalidConfiguration);
    }
  });

  it("rejects invalid dimensions", () => {
    const service = new MediaService(RealtimeModel.x2_fast_1080p);
    expect(() => service.resolveModelInputSize({ width: 0, height: 100 })).toThrow(
      XmaxError,
    );
  });
});
