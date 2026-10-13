import { describe, expect, it } from "vitest";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { createRtcManager } from "../src/Foundation/RTC/RtcFactory";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";
import { TrtcRtcManager } from "../src/Foundation/RTC/TRTC/TrtcRtcManager";
import { AgoraRtcManager } from "../src/Foundation/RTC/Agora/AgoraRtcManager";
import { XmaxEnvironment } from "../src/Foundation/Runtime/XmaxEnvironment";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";

describe("RTC provider selection", () => {
  it("preserves the legacy models' TRTC default and explicit provider selection", () => {
    expect(new RealtimeConfiguration({ model: RealtimeModel.x2_0_trtc }).provider).toBe(RtcProvider.trtc);
    expect(new RealtimeConfiguration({ model: RealtimeModel.x2_0_agora }).provider).toBe(RtcProvider.trtc);
    expect(new RealtimeConfiguration({ model: RealtimeModel.x2_0_agora, provider: RtcProvider.agora }).provider).toBe(RtcProvider.agora);
    expect(() => new RealtimeConfiguration({ model: RealtimeModel.x2_0_agora, provider: "unknown" as RtcProvider })).toThrow("Unsupported RTC provider");
  });

  it("defaults x2.1-preview-1013 to Agora and rejects incompatible providers", () => {
    const configuration = new RealtimeConfiguration({ model: RealtimeModel.x2_1_preview_1013 });
    expect(configuration.provider).toBe(RtcProvider.agora);
    expect(configuration.model).toBe("x2.1-preview-1013");
    expect(createRtcManager(configuration.provider, XmaxEnvironment.china)).toBeInstanceOf(AgoraRtcManager);
    expect(() => new RealtimeConfiguration({ model: RealtimeModel.x2_1_preview_1013, provider: RtcProvider.trtc }))
      .toThrow("x2.1-preview-1013 requires Agora");
  });

  it("constructs either adapter without eagerly loading browser-only RTC dependencies", () => {
    const trtc = createRtcManager(RtcProvider.trtc, XmaxEnvironment.china);
    const agora = createRtcManager(RtcProvider.agora, XmaxEnvironment.global);
    expect(trtc).toBeInstanceOf(TrtcRtcManager);
    expect(agora).toBeInstanceOf(AgoraRtcManager);
    expect(trtc.isInitialized).toBe(false);
    expect(agora.isInitialized).toBe(false);
  });
});
