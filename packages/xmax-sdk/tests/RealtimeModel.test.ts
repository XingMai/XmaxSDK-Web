import { describe, expect, it } from "vitest";
import {
  RealtimeModel, modelBaseURL, modelDisplayName, resolutionBuckets, minimumInputPixels,
  maximumInputPixels, inputSizeAlignment, defaultFrameRate, defaultCameraVideoFormat,
} from "../src/Service/Realtime/RealtimeModel";

describe("x2.1-preview-1013 defaults", () => {
  it("matches the mainline x2.1-preview media configuration and uses the dev endpoint", () => {
    const model = RealtimeModel.x2_1_preview_1013;
    expect(model).toBe("x2.1-preview-1013");
    expect(modelDisplayName(model)).toBe("x2.1");
    expect(modelBaseURL(model)).toBe("https://dev.xmaxai.com/open/api/v1");
    expect(resolutionBuckets(model)).toEqual([{ width: 1024, height: 1920 }, { width: 1920, height: 1024 }]);
    expect(minimumInputPixels(model)).toBe(600000);
    expect(maximumInputPixels(model)).toBe(2100000);
    expect(inputSizeAlignment(model)).toBe(32);
    expect(defaultFrameRate(model)).toBe(30);
    expect(defaultCameraVideoFormat(model)).toMatchObject({ width: 1024, height: 1920, fps: 30 });
  });
});
