import { describe, expect, it } from "vitest";
import { formatNetworkQuality } from "../src/formatNetworkQuality";

describe("network quality labels", () => {
  it.each([[0, "未知"], [1, "极好"], [2, "良好"], [3, "一般"], [4, "差"], [5, "极差"], [6, "断网"]])(
    "maps TRTC level %s to %s", (quality, label) => expect(formatNetworkQuality(quality)).toBe(label),
  );
  it("shows a placeholder for missing or invalid samples", () => {
    expect(formatNetworkQuality()).toBe("—");
    expect(formatNetworkQuality(7)).toBe("—");
  });
});
