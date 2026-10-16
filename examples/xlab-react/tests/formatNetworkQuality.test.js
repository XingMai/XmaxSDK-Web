import { describe, expect, it } from "vitest";
import { formatNetworkQuality } from "../src/formatNetworkQuality";

describe("network quality labels", () => {
  it.each([[0, "Unknown"], [1, "Excellent"], [2, "Good"], [3, "Fair"], [4, "Poor"], [5, "Very poor"], [6, "Disconnected"]])(
    "maps TRTC level %s to %s", (quality, label) => expect(formatNetworkQuality(quality)).toBe(label),
  );
  it("shows a placeholder for missing or invalid samples", () => {
    expect(formatNetworkQuality()).toBe("—");
    expect(formatNetworkQuality(7)).toBe("—");
  });
});
