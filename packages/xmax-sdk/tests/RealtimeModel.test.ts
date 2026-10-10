import { describe, expect, it } from "vitest";
import {
  RealtimeModel, defaultCameraVideoFormat, defaultFrameRate, inputSizeAlignment,
  maximumInputPixels, minimumInputPixels, modelBaseURL, modelDisplayName, resolutionBuckets,
} from "../src/Service/Realtime/RealtimeModel";
import { MediaService } from "../src/Service/Media/MediaService";
import { XmaxClient } from "../src/Core/XmaxClient";
import { XmaxConfiguration } from "../src/Core/XmaxConfiguration";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";

describe("custom realtime models", () => {
  it.each(["future-model", "toString", "__proto__", "constructor"])("uses preview defaults without replacing the identifier %s", (model) => {
    const preview = RealtimeModel.x2_1_preview;
    expect(modelDisplayName(model)).toBe(model);
    expect(modelBaseURL(model)).toBe(modelBaseURL(preview));
    expect(modelBaseURL(model)).toBe("https://cloud.xmax.22duck.cn/open/api/v1");
    expect(resolutionBuckets(model)).toEqual(resolutionBuckets(preview));
    expect(defaultCameraVideoFormat(model)).toEqual(defaultCameraVideoFormat(preview));
    expect(defaultFrameRate(model)).toBe(defaultFrameRate(preview));
    expect(minimumInputPixels(model)).toBe(minimumInputPixels(preview));
    expect(maximumInputPixels(model)).toBe(maximumInputPixels(preview));
    expect(inputSizeAlignment(model)).toBe(inputSizeAlignment(preview));

    const client = new XmaxClient(new XmaxConfiguration({ apiKey: "test-key" }));
    const configuration = new RealtimeConfiguration({ model });
    expect(client.createRealtimeManager(configuration).options.model).toBe(model);
    const media = client.createMediaService(model);
    for (const size of [{ width: 1024, height: 1920 }, { width: 1920, height: 1024 }]) {
      expect(media.resolveModelInputSize(size)).toEqual(size);
      expect(media.resolveFrameInterpolationSize(size)).toEqual(size);
    }
    expect(() => media.resolveModelInputSize({ width: 640, height: 360 })).toThrow("does not support input resolution");
    expect(new MediaService(model).model).toBe(model);
  });

  it("retains the original known-model display names and environment routing", () => {
    expect(modelDisplayName(RealtimeModel.x2_0_trtc)).toBe("X2.1-preview-trtc");
    expect(modelBaseURL(RealtimeModel.x2_0_trtc)).toBeUndefined();
    expect(modelDisplayName(RealtimeModel.x2_1_preview)).toBe("X2.1-preview-agora");
    expect(Object.values(RealtimeModel)).toEqual(["x2.0", "x2.0-trtc", "x2.1-preview"]);
    expect(modelBaseURL(RealtimeModel.x2_0)).toBeUndefined();
    expect(resolutionBuckets(RealtimeModel.x2_0)).toEqual([]);
    expect(maximumInputPixels(RealtimeModel.x2_0)).toBe(1280000);
  });
});
