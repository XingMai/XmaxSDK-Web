import { describe, expect, it } from "vitest";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import {
  RealtimeVideoEncoderPreference,
  RealtimeVideoFormat,
} from "../src/Service/Realtime/RealtimeVideoFormat";

describe("RealtimeVideoFormat", () => {
  it("accepts positive even dimensions and positive fps", () => {
    const format = new RealtimeVideoFormat({ width: 832, height: 1472, fps: 30 });
    expect(() => format.validate()).not.toThrow();
    expect(format.encoderPreference).toBe(RealtimeVideoEncoderPreference.auto);
  });

  it("rejects odd dimensions", () => {
    const format = new RealtimeVideoFormat({ width: 831, height: 1472, fps: 30 });
    expectXmaxError(() => format.validate(), XmaxErrorCode.invalidConfiguration);
  });

  it("rejects non-positive fps", () => {
    const format = new RealtimeVideoFormat({ width: 832, height: 1472, fps: 0 });
    expectXmaxError(() => format.validate(), XmaxErrorCode.invalidConfiguration);
  });

  it("rejects inverted bitrate range", () => {
    const format = new RealtimeVideoFormat({
      width: 832,
      height: 1472,
      fps: 30,
      minimumBitrate: 2000,
      maximumBitrate: 1000,
    });
    expectXmaxError(() => format.validate(), XmaxErrorCode.invalidConfiguration);
  });

  it("resized keeps fps and encoding configuration", () => {
    const format = new RealtimeVideoFormat({
      width: 832,
      height: 1472,
      fps: 24,
      minimumBitrate: 500,
      maximumBitrate: 2500,
      encoderPreference: RealtimeVideoEncoderPreference.maintainFramerate,
    });
    const resized = format.resized(640, 1136);
    expect(resized.width).toBe(640);
    expect(resized.height).toBe(1136);
    expect(resized.fps).toBe(24);
    expect(resized.minimumBitrate).toBe(500);
    expect(resized.maximumBitrate).toBe(2500);
    expect(resized.encoderPreference).toBe(
      RealtimeVideoEncoderPreference.maintainFramerate,
    );
  });
});

function expectXmaxError(body: () => void, code: XmaxErrorCode): void {
  try {
    body();
  } catch (error) {
    expect(error).toBeInstanceOf(XmaxError);
    expect((error as XmaxError).code).toBe(code);
    return;
  }
  throw new Error("Expected XmaxError to be thrown");
}
