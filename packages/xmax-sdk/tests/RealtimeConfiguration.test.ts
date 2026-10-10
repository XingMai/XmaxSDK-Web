import { describe, expect, it } from "vitest";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";

describe("RealtimeConfiguration", () => {
  it.each([
    [RealtimeModel.x2_0_agora, RtcProvider.agora],
    [RealtimeModel.x2_0_trtc, RtcProvider.trtc],
    [RealtimeModel.x2_1_preview, RtcProvider.vertc],
  ] as const)("keeps the public configuration minimal for %s", (model, provider) => {
    expect(new RealtimeConfiguration({ model })).toEqual({ model, provider, isFrameInterpolationEnabled: false });
  });
});
