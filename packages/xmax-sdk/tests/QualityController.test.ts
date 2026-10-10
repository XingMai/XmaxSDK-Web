import { describe, expect, it, vi } from "vitest";
import { QualityController, type QualityChange } from "../src/Stream/Quality/QualityController";

function setup() {
  let now = 0;
  const apply = vi.fn(async (_change: QualityChange, _signal: AbortSignal) => {});
  const controller = new QualityController(apply, () => now);
  const sample = (quality: number | undefined, delta = 2000) => {
    now += delta;
    return controller.observe(quality, now);
  };
  const samples = async (quality: number, count: number) => {
    for (let i = 0; i < count; i++) await sample(quality);
  };
  return { controller, apply, sample, samples, advance: (ms: number) => { now += ms; } };
}

describe("QualityController", () => {
  it("is inactive until explicitly started; stops counting on session end", async () => {
    const s = setup();
    await s.samples(5, 10);
    expect(s.apply).not.toHaveBeenCalled();
    s.controller.start();
    await s.samples(5, 2);
    s.controller.stop();
    await s.samples(5, 10);
    expect(s.apply).not.toHaveBeenCalled();
  });

  it("downgrades one tier on three poor samples with a stabilization pause", async () => {
    const s = setup(); s.controller.start();
    await s.samples(4, 2);
    expect(s.apply).not.toHaveBeenCalled();
    expect(await s.sample(5)).toMatchObject({ from: 1, to: 2, frameRate: 24, reason: "poorNetwork" });
    await s.sample(5); // 稳定期，不能累计
    await s.samples(5, 2);
    expect(s.apply).toHaveBeenCalledTimes(1);
    await s.sample(5);
    expect(s.controller.snapshot.level).toBe(3);
  });

  it.each([3, 0, 6, undefined, 9])("breaks consecutive counters on quality %s", async quality => {
    const s = setup(); s.controller.start(2);
    await s.samples(5, 2);
    await s.sample(quality);
    await s.samples(5, 2);
    expect(s.apply).not.toHaveBeenCalled();
    await s.sample(2);
    await s.samples(1, 3);
    await s.sample(quality);
    await s.samples(1, 4);
    expect(s.apply).not.toHaveBeenCalled();
  });

  it("requires five fresh good samples to probe an upgrade", async () => {
    const s = setup(); s.controller.start(5);
    await s.samples(1, 4);
    expect(s.apply).not.toHaveBeenCalled();
    expect(await s.sample(2)).toMatchObject({ from: 5, to: 4, frameRate: 20, reason: "probeUpgrade" });
  });

  it("rolls back failed probes and blocks upgrades for 60 seconds but permits downgrades", async () => {
    const s = setup(); s.controller.start(3);
    await s.samples(1, 5); // L3 -> L2
    await s.sample(5); // 稳定期
    await s.samples(5, 2);
    expect(await s.sample(5)).toMatchObject({ from: 2, to: 3, reason: "failedProbe" });
    await s.samples(1, 12);
    expect(s.controller.snapshot.level).toBe(3);
    await s.samples(5, 3);
    expect(s.controller.snapshot.level).toBe(4);
    await s.samples(1, 14); // 尚未到冷却结束
    expect(s.controller.snapshot.level).toBe(4);
    await s.samples(1, 4); // 到期后重新累计，不使用冷却期中的好样本
    expect(s.controller.snapshot.level).toBe(4);
    await s.sample(1);
    expect(s.controller.snapshot.level).toBe(3);
  });

  it("never applies beyond tier limits", async () => {
    const s = setup(); s.controller.start(1);
    await s.samples(1, 50);
    s.controller.start(5);
    await s.samples(5, 50);
    expect(s.apply).not.toHaveBeenCalled();
  });

  it("distinguishes L2 and L3 even though both use 24 fps", async () => {
    const s = setup(); s.controller.start(2);
    await s.samples(5, 3);
    expect(s.controller.snapshot).toMatchObject({ level: 3, frameRate: 24, width: 640, height: 1200 });
    expect(s.apply).toHaveBeenLastCalledWith(expect.objectContaining({ from: 2, to: 3, frameRate: 24 }), expect.any(AbortSignal));
    await s.sample(1);
    await s.samples(1, 5);
    expect(s.controller.snapshot).toMatchObject({ level: 2, frameRate: 24, width: 768, height: 1440 });
  });

  it("resets after sample gaps and ignores duplicate timestamps", async () => {
    const s = setup(); s.controller.start();
    await s.samples(5, 2);
    await s.sample(5, 0);
    expect(s.apply).not.toHaveBeenCalled();
    await s.sample(5, 6000);
    await s.sample(5);
    expect(s.apply).not.toHaveBeenCalled();
    await s.sample(5);
    expect(s.controller.snapshot.level).toBe(2);
  });

  it("ignores future/stale samples without blocking subsequent fresh samples", async () => {
    const s = setup(); s.controller.start();
    await s.controller.observe(5, 100000);
    s.advance(10000);
    await s.controller.observe(5, 0);
    await s.samples(5, 2);
    expect(s.apply).not.toHaveBeenCalled();
    await s.sample(5);
    expect(s.controller.snapshot.level).toBe(2);
  });

  it("validates the initial tier and policy", () => {
    const s = setup();
    expect(() => s.controller.start(25)).toThrow("Unsupported");
    expect(() => new QualityController(s.apply, undefined, { goodSamples: 0 })).toThrow();
    expect(() => new QualityController(s.apply, undefined, { poorSamples: 1.5 })).toThrow();
    expect(() => new QualityController(s.apply, undefined, { stabilizationMs: -1 })).toThrow();
  });

  it("does not commit failure, resets counts, and allows retry after stabilization", async () => {
    const s = setup(); s.controller.start();
    s.apply.mockRejectedValueOnce(new Error("encoder failed"));
    await s.samples(5, 2);
    await expect(s.sample(5)).rejects.toThrow("encoder failed");
    expect(s.controller.snapshot).toMatchObject({ level: 1, switching: false });
    await s.sample(5);
    await s.samples(5, 3);
    expect(s.controller.snapshot.level).toBe(2);
  });

  it("serializes applies and ignores late completion after a new lifecycle starts", async () => {
    const s = setup(); s.controller.start();
    let finish!: () => void;
    s.apply.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await s.samples(5, 2);
    const pending = s.sample(5);
    expect(s.controller.snapshot).toMatchObject({ switching: true, level: 1 });
    await s.samples(5, 5);
    expect(s.apply).toHaveBeenCalledTimes(1);
    const signal = s.apply.mock.calls[0]![1];
    s.controller.start(3);
    expect(signal.aborted).toBe(true);
    finish(); await pending;
    expect(s.controller.snapshot).toMatchObject({ level: 3, switching: false });
    await s.samples(5, 3);
    expect(s.controller.snapshot.level).toBe(4);
  });
});
