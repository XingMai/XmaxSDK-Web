import { afterEach, describe, expect, it, vi } from "vitest";
import { QualityHistory } from "../src/Stream/Quality/QualityHistory";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";

afterEach(() => vi.unstubAllGlobals());

function storage() {
  const data = new Map<string, string>();
  const store = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
  };
  vi.stubGlobal("localStorage", store);
  return store;
}

describe("QualityHistory", () => {
  it("isolates providers while preserving existing Agora keys", () => {
    const store = storage();
    const agora = new QualityHistory("same-model", RtcProvider.agora);
    const trtc = new QualityHistory("same-model", RtcProvider.trtc);
    agora.write("uplink", 4);
    expect(store.setItem).toHaveBeenCalledWith("xmax:quality:v1:agora:same-model:uplink", "4");
    expect(trtc.read("uplink")).toBe(2);
    trtc.write("uplink", 3);
    trtc.write("downlink", 5);
    expect(agora.read("uplink")).toBe(4);
    expect(agora.read("downlink")).toBe(2);
    const next = new QualityHistory("same-model", RtcProvider.trtc);
    expect(next.read("uplink")).toBe(3);
    expect(next.read("downlink")).toBe(5);
  });

  it.each([RtcProvider.agora, RtcProvider.trtc])("defaults to L2 and persists each direction across instances, isolated by model (%s)", provider => {
    storage();
    const history = new QualityHistory("model-a", provider);
    expect(history.read("uplink")).toBe(2);
    history.write("uplink", 3);
    history.write("downlink", 5);
    const next = new QualityHistory("model-a", provider);
    expect(next.read("uplink")).toBe(3);
    expect(next.read("downlink")).toBe(5);
    expect(new QualityHistory("model-b", provider).read("uplink")).toBe(2);
  });

  it.each([null, "", "0", "6", "1.5", "NaN", "Infinity", "{}"])("ignores invalid stored value %s", value => {
    storage().getItem.mockReturnValue(value);
    expect(new QualityHistory("model", RtcProvider.trtc).read("uplink")).toBe(2);
  });

  it("ignores invalid writes", () => {
    const store = storage();
    const history = new QualityHistory("model", RtcProvider.trtc);
    for (const level of [0, 6, 1.5, NaN, Infinity]) history.write("uplink", level);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it("tolerates unavailable storage and quota/security failures", () => {
    const history = new QualityHistory("model", RtcProvider.trtc);
    vi.stubGlobal("localStorage", undefined);
    expect(history.read("uplink")).toBe(2);
    expect(() => history.write("uplink", 4)).not.toThrow();
    const store = storage();
    store.getItem.mockImplementation(() => { throw new Error("SecurityError"); });
    store.setItem.mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(history.read("downlink")).toBe(2);
    expect(() => history.write("downlink", 4)).not.toThrow();
  });
});
