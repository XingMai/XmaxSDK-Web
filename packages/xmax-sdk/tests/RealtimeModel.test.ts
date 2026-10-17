import { describe, expect, it } from "vitest";
import {
  RealtimeModel, defaultCameraVideoFormat, defaultFrameRate, inputSizeAlignment,
  maximumInputPixels, minimumInputPixels, modelBaseURL, modelDisplayName, resolutionBuckets,
  supportedRtcProviders,
} from "../src/Service/Realtime/RealtimeModel";
import { MediaService } from "../src/Service/Media/MediaService";
import { XmaxClient } from "../src/Core/XmaxClient";
import { XmaxConfiguration } from "../src/Core/XmaxConfiguration";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";

describe("custom realtime models", () => {
  it.each(["future-model", "toString", "__proto__", "constructor"])("uses preview defaults without replacing the identifier %s", (model) => {
    const preview = RealtimeModel.x2_1_1_preview_cn;
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

  it("exposes only CN and US models", () => {
    expect(Object.values(RealtimeModel)).toEqual([
      "x2.1.1-preview-cn", "x2.1.1-preview-us",
    ]);
    expect(new XmaxClient(new XmaxConfiguration({ apiKey: "test-key" })).createMediaService())
      .toMatchObject({ model: RealtimeModel.x2_1_1_preview_cn });
  });
});

describe("preview model variants", () => {
  it.each([
    [RealtimeModel.x2_1_1_preview_cn, "x2.1.1-preview-cn", "X2.1.1-preview-cn", "https://cloud.xmax.22duck.cn/open/api/v1"],
    [RealtimeModel.x2_1_1_preview_us, "x2.1.1-preview-us", "X2.1.1-preview-us", "https://api.xmax.ai/open/api/v1"],
  ] as const)("uses the expected endpoint and media defaults for %s", (model, identifier, displayName, baseURL) => {
    expect(model).toBe(identifier);
    expect(modelDisplayName(model)).toBe(displayName);
    expect(modelBaseURL(model)).toBe(baseURL);
    expect(supportedRtcProviders(model)).toEqual([RtcProvider.agora]);
    expect(new RealtimeConfiguration({ model })).toMatchObject({ model, provider: RtcProvider.agora });
    expect(resolutionBuckets(model)).toEqual([{ width: 1024, height: 1920 }, { width: 1920, height: 1024 }]);
    expect(defaultCameraVideoFormat(model)).toMatchObject({ width: 1024, height: 1920, fps: 30 });
    expect(defaultFrameRate(model)).toBe(30);
    expect(maximumInputPixels(model)).toBe(2100000);
    expect(minimumInputPixels(model)).toBe(600000);
    expect(inputSizeAlignment(model)).toBe(32);
  });
});
