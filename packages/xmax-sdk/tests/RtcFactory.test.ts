import { describe, expect, it } from "vitest";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { createRtcManager } from "../src/Foundation/RTC/RtcFactory";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";
import { TrtcRtcManager } from "../src/Foundation/RTC/TRTC/TrtcRtcManager";
import { VeRtcManager } from "../src/Foundation/RTC/VeRTC/VeRtcManager";
import { AgoraRtcManager } from "../src/Foundation/RTC/Agora/AgoraRtcManager";
import { XmaxEnvironment } from "../src/Foundation/Runtime/XmaxEnvironment";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";

describe("RTC provider selection", () => {
  it("keeps TRTC as the explicit default instead of deriving the provider from the model", () => {
    expect(new RealtimeConfiguration({ model: RealtimeModel.x2_1_preview }).provider).toBe(RtcProvider.trtc);
    expect(new RealtimeConfiguration({ model: RealtimeModel.x2_0_trtc }).provider).toBe(RtcProvider.trtc);
    expect(new RealtimeConfiguration({ model: RealtimeModel.x2_0_agora }).provider).toBe(RtcProvider.trtc);
    expect(new RealtimeConfiguration({ model: RealtimeModel.x2_0_agora, provider: RtcProvider.agora }).provider).toBe(RtcProvider.agora);
    expect(() => new RealtimeConfiguration({ model: RealtimeModel.x2_0_agora, provider: "unknown" as RtcProvider })).toThrow("Unsupported RTC provider");
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
