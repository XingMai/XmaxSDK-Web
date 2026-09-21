import { beforeEach, describe, expect, it, vi } from "vitest";
import { RtcEngineManager } from "../src/Foundation/RTC/RtcEngineManager";

const { setLogLevel, create, destroy } = vi.hoisted(() => ({
  setLogLevel: vi.fn(),
  create: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("trtc-sdk-v5", () => ({ default: { setLogLevel, create } }));

describe("RtcEngineManager TRTC logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockReturnValue({ destroy });
  });

  it("disables vendor console logs before creating each engine without disabling diagnostic upload", async () => {
    const manager = new RtcEngineManager();
    const first = await manager.acquire();
    expect(setLogLevel).toHaveBeenCalledTimes(1);
    expect(setLogLevel).toHaveBeenCalledWith(5);
    expect(setLogLevel.mock.invocationCallOrder[0]!).toBeLessThan(create.mock.invocationCallOrder[0]!);
    manager.release(first);

    const second = await manager.acquire();
    expect(setLogLevel).toHaveBeenCalledTimes(2);
    expect(setLogLevel).toHaveBeenLastCalledWith(5);
    expect(setLogLevel.mock.invocationCallOrder[1]!).toBeLessThan(create.mock.invocationCallOrder[1]!);
    manager.release(second);
  });
});
