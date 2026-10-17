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
  it("isolates providers while storing timestamps with each level", () => {
    const store = storage();
    const agora = new QualityHistory("same-model", RtcProvider.agora);
    const trtc = new QualityHistory("same-model", RtcProvider.trtc);
    agora.write("uplink", 4);
    expect(store.setItem).toHaveBeenCalledWith("xmax:quality:v1:agora:same-model:uplink", expect.any(String));
    expect(JSON.parse(store.setItem.mock.calls[0]![1])).toMatchObject({ level: 4, savedAt: expect.any(Number) });
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

  it("expires exactly one hour after the latest successful write", () => {
    storage();
    let now = 1000;
    const history = new QualityHistory("model", RtcProvider.agora, () => now);
    history.write("uplink", 5);
    now += 3_599_999;
    expect(history.read("uplink")).toBe(5);
    now++;
    expect(history.read("uplink")).toBe(2);

    history.write("uplink", 4);
    now += 3_000_000;
    history.write("uplink", 3);
    now += 1_000_000;
    expect(history.read("uplink")).toBe(3);
  });

  it.each(["4", '{"level":4}', '{"level":4,"savedAt":0}',
    '{"level":4,"savedAt":2000}', '{"level":4,"savedAt":"1000"}',
    '{"level":6,"savedAt":1000}', "malformed"])("ignores legacy or invalid history %s", value => {
    storage().getItem.mockReturnValue(value);
    expect(new QualityHistory("model", RtcProvider.agora, () => 1000).read("uplink")).toBe(2);
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
