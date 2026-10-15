import { describe, expect, it } from "vitest";
import { RecordingTimeline } from "../src/Media/Recording/RecordingTimeline";

describe("RecordingTimeline", () => {
  it("preserves regular frame rates and small jitter", () => {
    const timeline = new RecordingTimeline([0, 0.04, 0.085, 0.12, 0.2, 0.24], 0.28);
    expect(timeline.cuts).toEqual([]);
    expect(timeline.map(0.2)).toBe(0.2);
  });

  it("shortens long holds to a typical frame and applies the same mapping to audio", () => {
    const timeline = new RecordingTimeline([0, 0.04, 0.08, 1.3, 1.34, 1.38], 1.42);
    expect(timeline.cuts).toHaveLength(1);
    expect(timeline.cuts[0]!.start).toBeCloseTo(0.12);
    expect(timeline.cuts[0]!.end).toBe(1.3);
    expect(timeline.map(1.3)).toBeCloseTo(0.12);
    expect(timeline.map(1.38)).toBeCloseTo(0.2);
    expect(timeline.map(1.42)).toBeCloseTo(0.24);
  });

  it("does not mistake a stable low frame rate for repeated network stalls", () => {
    const timeline = new RecordingTimeline([0, 0.2, 0.4, 0.6, 0.8], 1);
    expect(timeline.cuts).toEqual([]);
  });

  it("handles presentation order independently of decode order", () => {
    const timeline = new RecordingTimeline([0, 0.08, 0.04, 0.8, 0.84, 0.88], 0.92);
    expect(timeline.cuts).toHaveLength(1);
    expect(timeline.map(0.84)).toBeCloseTo(0.16);
  });

  it("cuts a trailing stall using the duration of both tracks", () => {
    const timeline = new RecordingTimeline([0, 0.04, 0.08], 1);
    expect(timeline.map(1)).toBeCloseTo(0.12);
    expect(timeline.removes(0.2, 1)).toBe(true);
  });

  it("aligns both cuts to whole audio packets instead of accumulating rounding errors", () => {
    const audio = Array.from({ length: 54 }, (_, i) => ({ start: i * 0.02, end: (i + 1) * 0.02 }));
    const timeline = new RecordingTimeline([0, 0.033, 0.066, 0.5, 0.533, 0.566, 1, 1.033], 1.066, audio);
    expect(timeline.cuts).toEqual([{ start: 0.1, end: 0.5 }, { start: 0.6, end: 1 }]);
    expect(timeline.map(1)).toBeCloseTo(0.2);
    expect(timeline.removes(0.08, 0.1)).toBe(false);
    expect(timeline.removes(0.1, 0.12)).toBe(true);
    expect(timeline.removes(0.5, 0.52)).toBe(false);
    expect(timeline.removes(-0.02, 0)).toBe(false);
  });

  it("preserves a leading audio/video offset", () => {
    const timeline = new RecordingTimeline([0.2, 0.24, 0.28, 1, 1.04, 1.08], 1.12);
    expect(timeline.map(0.2)).toBe(0.2);
    expect(timeline.removes(0, 0.2)).toBe(false);
  });

  it("maps times inside a removed interval to its splice point", () => {
    const timeline = new RecordingTimeline([0, 0.04, 0.08, 1, 1.04], 1.08);
    expect(timeline.map(0.5)).toBeCloseTo(0.12);
    expect(timeline.removes(0.5, 0.9)).toBe(true);
    expect(timeline.removes(1, 1.04)).toBe(false);
  });

  it.each([{ timestamps: [] }, { timestamps: [NaN] }, { timestamps: [-0.1] }, { timestamps: [2] }])("rejects invalid video timestamps $timestamps", ({ timestamps }) => {
    expect(() => new RecordingTimeline(timestamps, 1)).toThrow("Invalid recording timeline");
  });
});
