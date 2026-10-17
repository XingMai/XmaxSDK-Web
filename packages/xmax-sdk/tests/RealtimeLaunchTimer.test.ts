import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeLaunchTimer } from "../src/Core/Realtime/RealtimeLaunchTimer";
import type { RealtimeLaunchTiming } from "../src/Service/Realtime/RealtimeLaunchTiming";

afterEach(() => vi.restoreAllMocks());

describe("RealtimeLaunchTimer connection stages", () => {
  it("keeps first frame separate and completes total only after render warmup", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const timer = new RealtimeLaunchTimer();
    const listener = vi.fn();
    timer.setListener(listener);
    timer.start();
    now = 500;
    const firstFrame = timer.startFirstFrame();
    now = 800;
    firstFrame();
    expect(listener).toHaveBeenLastCalledWith({ firstFrameMs: 300 });
    const warmup = timer.startRenderWarmup();
    now = 1800;
    warmup();
    expect(listener).toHaveBeenLastCalledWith({ firstFrameMs: 300, renderWarmupMs: 1000, totalMs: 1800 });
    now = 2300;
    warmup();
    expect(listener).toHaveBeenLastCalledWith({ firstFrameMs: 300, renderWarmupMs: 1000, totalMs: 1800 });
  });

  it("records each stage once without completing the overall launch", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const timer = new RealtimeLaunchTimer();
    const snapshots: RealtimeLaunchTiming[] = [];
    timer.setListener(value => { snapshots.push(value); });
    timer.start();
    for (const [start, duration] of [
      [() => timer.startSession(), 120],
      [() => timer.startRtcJoin(), 350],
    ] as const) {
      const complete = start();
      now += duration;
      complete();
      complete();
    }
    expect(snapshots.at(-1)).toEqual({ sessionMs: 120, rtcJoinMs: 350 });
    expect(snapshots).toHaveLength(4);
    expect(Object.isFrozen(snapshots.at(-1))).toBe(true);
  });

  it("ignores cancelled and previous-cycle completion callbacks", () => {
    const timer = new RealtimeLaunchTimer();
    const listener = vi.fn();
    timer.setListener(listener);
    timer.start();
    const completeJoin = timer.startRtcJoin();
    const completeSession = timer.startSession();
    const completeWarmup = timer.startRenderWarmup();
    timer.cancel();
    completeJoin();
    completeWarmup();
    expect(listener).toHaveBeenCalledTimes(2);
    timer.start();
    completeSession();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith({});
  });
});
