import { describe, expect, it } from "vitest";
import { snapshotExtraParams, type RealtimeExtraParams } from "../src/Service/Realtime/RealtimeExtraParams";

describe("generation extraParams", () => {
  it("copies JSON values without retaining the caller's object", () => {
    const input = { static_generate: true, static_image_path: "https://example.com/image.jpg", nested: { values: [null, false, 0, ""] } };
    const copy = snapshotExtraParams(input);
    expect(copy).toEqual(input);
    input.nested.values.push("later");
    expect(copy).not.toEqual(input);
    expect(snapshotExtraParams()).toBeUndefined();
    expect(snapshotExtraParams({})).toEqual({});
  });

  it.each(["model", "face_replace", "size", "target_size", "prompt", "ref_image_path", "mirror", "ref_video_path", "sample_method", "min_bitrate", "max_bitrate"])("rejects reserved parameter %s", key => {
    expect(() => snapshotExtraParams({ [key]: null })).toThrow("conflicts with SDK parameter");
  });

  it.each([undefined, () => {}, Symbol("value"), BigInt(1), NaN, Infinity, new Date(), new Map()])("rejects non-JSON nested values: %s", value => {
    expect(() => snapshotExtraParams({ nested: { value } } as RealtimeExtraParams)).toThrow();
  });

  it("rejects cycles and symbol keys but permits shared non-cyclic objects", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => snapshotExtraParams(cyclic as RealtimeExtraParams)).toThrow("circular");
    expect(() => snapshotExtraParams({ [Symbol("key")]: 1 })).toThrow("symbol");
    const shared = { flag: true };
    expect(snapshotExtraParams({ a: shared, b: shared })).toEqual({ a: shared, b: shared });
  });

  it.each([null, [], "value", 1])("requires an object: %s", value => {
    expect(() => snapshotExtraParams(value as unknown as RealtimeExtraParams)).toThrow("JSON object");
  });
});
