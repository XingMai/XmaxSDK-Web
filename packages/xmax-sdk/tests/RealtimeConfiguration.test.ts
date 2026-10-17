import { describe, expect, it } from "vitest";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";

describe("RealtimeConfiguration", () => {
  it.each([
    [RealtimeModel.x2_1_1_preview_cn, RtcProvider.agora],
    [RealtimeModel.x2_1_1_preview_us, RtcProvider.agora],
  ] as const)("keeps the public configuration minimal for %s", (model, provider) => {
    expect(new RealtimeConfiguration({ model })).toEqual({ model, provider, isFrameInterpolationEnabled: false });
  });
});
