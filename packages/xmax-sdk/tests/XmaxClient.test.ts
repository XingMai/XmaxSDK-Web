import { afterEach, describe, expect, it, vi } from "vitest";
import { XmaxClient } from "../src/Core/XmaxClient";
import { XmaxConfiguration } from "../src/Core/XmaxConfiguration";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { XmaxRealtimeManager } from "../src/Core/Realtime/XmaxRealtimeManager";
import { XmaxEnvironment } from "../src/Foundation/Runtime/XmaxEnvironment";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";

vi.mock("../src/Core/Realtime/XmaxRealtimeManager", () => ({
  XmaxRealtimeManager: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("realtime session endpoint routing", () => {
  it.each([
    { model: "x2.0-trtc", environment: XmaxEnvironment.china,
      apiBaseURL: "https://api.xmaxai.com/open/api/v1", expected: "https://api.xmaxai.com/open/api/v1" },
    { model: "x2.0-trtc", environment: XmaxEnvironment.china,
      apiBaseURL: undefined, expected: "https://dev.xmaxai.com/open/api/v1" },
    { model: "x2.1-preview-trtc", environment: XmaxEnvironment.china, provider: RtcProvider.trtc,
      apiBaseURL: "https://dev.xmaxai.com/open/api/v1", expected: "https://dev.xmaxai.com/open/api/v1" },
    { model: "x2.1-preview", environment: XmaxEnvironment.global,
      apiBaseURL: "https://api.xmaxai.com/open/api/v1", expected: "https://api.xmaxai.com/open/api/v1" },
    { model: "x2.1-preview-1014", environment: XmaxEnvironment.global,
      apiBaseURL: undefined, expected: "https://dev.xmaxai.com/open/api/v1" },
    { model: "x2.0", environment: XmaxEnvironment.global,
      apiBaseURL: undefined, expected: "https://api.xmax.cloud/open/api/v1" },
  ])("routes $model in $environment to $expected (override: $apiBaseURL)", async ({ model, environment, apiBaseURL, expected, provider }) => {
    const fetch = vi.fn().mockResolvedValue({
      status: 200, text: async () => JSON.stringify({ success: true, code: 200, data: {} }),
    });
    vi.stubGlobal("fetch", fetch);
    const client = new XmaxClient(new XmaxConfiguration({ apiKey: "test-key", environment }));
    client.createRealtimeManager(new RealtimeConfiguration({ model, apiBaseURL, provider }));
    expect(fetch).not.toHaveBeenCalled();
    if (provider !== undefined) {
      expect(vi.mocked(XmaxRealtimeManager).mock.calls[0]![0].provider).toBe(provider);
    }
    const api = vi.mocked(XmaxRealtimeManager).mock.calls[0]![1]!.apiService!;
    await api.post("/session", { model });
    await api.put("/session/test-session/heartbeat");
    await api.delete("/session/test-session");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${expected}/session`, `${expected}/session/test-session/heartbeat`, `${expected}/session/test-session`,
    ]);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ model });
  });
});
