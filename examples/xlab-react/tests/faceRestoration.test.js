import { expect, it } from "vitest";
import { EXAMPLE_MODES, faceRestorationForMode } from "../src/presets";

it.each(EXAMPLE_MODES)("sets face restoration for $key", ({ key }) => {
  expect(faceRestorationForMode(key)).toBe(key === "clothx");
});

it("turns restoration on only during clothing generation and off again for other modes", () => {
  expect(["charx", "clothx", "clothx", "free", "clothx", "vibex"].map(faceRestorationForMode))
    .toEqual([false, true, true, false, true, false]);
});
