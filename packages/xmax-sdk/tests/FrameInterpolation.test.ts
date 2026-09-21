import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { MediaService } from "../src/Service/Media/MediaService";
import { frameInterpolationAdapter } from "../src/Foundation/Media/Video/FrameInterpolationSupport";
import { weightsBase64, weightsManifest } from "../src/Foundation/Media/Video/FramegenWeights.generated";

afterEach(() => vi.unstubAllGlobals());

describe("frame interpolation configuration and support", () => {
  it("defaults on, preserves the iOS flag, and gives the explicit Web option priority", () => {
    const model = RealtimeModel.x2_fast_1080p;
    expect(new RealtimeConfiguration({ model }).frameInterpolation).toEqual({ enabled: true, targetFrameRate: 60 });
    expect(new RealtimeConfiguration({ model, isFrameInterpolationEnabled: false }).frameInterpolation.enabled).toBe(false);
    const options = new RealtimeConfiguration({ model, isFrameInterpolationEnabled: false, frameInterpolation: { enabled: true, targetFrameRate: 30 } });
    expect(options.isFrameInterpolationEnabled).toBe(true);
    expect(Object.isFrozen(options.frameInterpolation)).toBe(true);
    for (const targetFrameRate of [0, -1, 61, NaN, Infinity]) {
      expect(() => new RealtimeConfiguration({ model, frameInterpolation: { targetFrameRate } })).toThrow();
    }
  });

  it("preserves original dimensions above 900000 pixels, including sizes requiring GPU padding", () => {
    const media = new MediaService();
    for (const [width, height] of [[1920, 1024], [1024, 1920], [1920, 1080], [832, 1472], [1280, 720], [1009, 1013], [640, 480], [32, 32], [2, 2]]) {
      const size = media.resolveFrameInterpolationSize({ width: width!, height: height! });
      expect(size).toEqual({ width, height });
    }
    for (const width of [0, -2, 1.5, Infinity, NaN]) {
      expect(() => media.resolveFrameInterpolationSize({ width, height: 720 })).toThrow();
    }
  });

  it("rejects unsupported adapters without creating a device", async () => {
    vi.stubGlobal("navigator", {});
    expect(await frameInterpolationAdapter()).toBeNull();
    class Video { requestVideoFrameCallback() {} }
    vi.stubGlobal("HTMLVideoElement", Video);
    const requestDevice = vi.fn();
    const adapter = { features: new Set(), limits: { maxTextureDimension2D: 8192 }, requestDevice };
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => adapter } });
    expect(await frameInterpolationAdapter()).toBeNull();
    adapter.features.add("shader-f16");
    expect(await frameInterpolationAdapter({ width: 320, height: 180 })).toBe(adapter);
    expect(await frameInterpolationAdapter({ width: 1920, height: 1080 })).toBe(adapter);
    expect(await frameInterpolationAdapter({ width: 8193, height: 1080 })).toBeNull();
    expect(await frameInterpolationAdapter({ width: -1, height: 1080 })).toBeNull();
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it("includes complete float32 weights for every manifest tensor", () => {
    const bytes = atob(weightsBase64).length;
    expect(bytes).toBe(2945824);
    for (const tensor of Object.values(weightsManifest)) {
      const count = tensor.shape.reduce((n, dim) => n * dim, 1);
      expect((tensor.offset + count) * 4).toBeLessThanOrEqual(bytes);
    }
  });
});
