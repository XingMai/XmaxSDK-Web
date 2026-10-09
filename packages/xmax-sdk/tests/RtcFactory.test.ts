import { describe, expect, it } from "vitest";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { createRtcManager } from "../src/Foundation/RTC/RtcFactory";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";
import { TrtcRtcManager } from "../src/Foundation/RTC/TRTC/TrtcRtcManager";
import { VeRtcManager } from "../src/Foundation/RTC/VeRTC/VeRtcManager";
import { AgoraRtcManager } from "../src/Foundation/RTC/Agora/AgoraRtcManager";
import { XmaxEnvironment } from "../src/Foundation/Runtime/XmaxEnvironment";
import { RealtimeModel, supportedRtcProviders } from "../src/Service/Realtime/RealtimeModel";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";

describe("RTC provider selection", () => {
  const supported = [
    [RealtimeModel.x2_0, RtcProvider.vertc],
    [RealtimeModel.x2_0_pro, RtcProvider.vertc],
    [RealtimeModel.x2_0_trtc, RtcProvider.trtc],
    [RealtimeModel.x2_0_agora, RtcProvider.agora],
    [RealtimeModel.x2_1_preview, RtcProvider.vertc],
    [RealtimeModel.x2_1_preview_1005, RtcProvider.vertc],
  ] as const;

  it.each(supported)("defines %s support and default as %s", (model, provider) => {
    expect(supportedRtcProviders(model)).toEqual([provider]);
    expect(Object.isFrozen(supportedRtcProviders(model))).toBe(true);
    expect(new RealtimeConfiguration({ model }).provider).toBe(provider);
    expect(new RealtimeConfiguration({ model, provider }).provider).toBe(provider);
  });

  it.each(supported)("rejects unsupported providers for %s before creating a manager", (model, supportedProvider) => {
    for (const provider of Object.values(RtcProvider)) {
      if (provider !== supportedProvider) {
        expect(() => new RealtimeConfiguration({ model, provider })).toThrow("does not support RTC provider");
      }
    }
  });

  it.each(["future-model", "toString", "__proto__", "constructor"])("accepts custom model %s with preview defaults and explicit provider overrides", (model) => {
    const configuration = new RealtimeConfiguration({ model });
    expect(configuration.model).toBe(model);
    expect(configuration.provider).toBe(new RealtimeConfiguration({ model: RealtimeModel.x2_1_preview }).provider);
    expect(Object.isFrozen(supportedRtcProviders(model))).toBe(true);
    for (const provider of Object.values(RtcProvider)) {
      expect(supportedRtcProviders(model)).toContain(provider);
      expect(new RealtimeConfiguration({ model, provider }).provider).toBe(provider);
    }
    expect(() => new RealtimeConfiguration({ model, provider: "unknown" as RtcProvider })).toThrow("Unsupported RTC provider");
  });

  it.each(["", "   ", null, undefined, 123, {}])("rejects malformed model identifiers (%j)", (model) => {
    expect(() => new RealtimeConfiguration({ model: model as string })).toThrow(
      expect.objectContaining({ code: XmaxErrorCode.invalidConfiguration }),
    );
  });

  it("rejects unknown providers", () => {
    expect(() => new RealtimeConfiguration({ model: RealtimeModel.x2_0_agora, provider: "unknown" as RtcProvider })).toThrow("Unsupported RTC provider");
    expect(() => createRtcManager("unknown" as RtcProvider, XmaxEnvironment.china)).toThrow(
      expect.objectContaining({ code: XmaxErrorCode.invalidConfiguration }),
    );
  });

  it("constructs all adapters without eagerly loading browser-only RTC dependencies", () => {
    const trtc = createRtcManager(RtcProvider.trtc, XmaxEnvironment.china);
    const agora = createRtcManager(RtcProvider.agora, XmaxEnvironment.global);
    const vertc = createRtcManager(RtcProvider.vertc, XmaxEnvironment.china);
    expect(vertc).toBeInstanceOf(VeRtcManager);
    expect(vertc.isInitialized).toBe(false);
    expect(trtc).toBeInstanceOf(TrtcRtcManager);
    expect(agora).toBeInstanceOf(AgoraRtcManager);
    expect(trtc.isInitialized).toBe(false);
    expect(agora.isInitialized).toBe(false);
  });
});
