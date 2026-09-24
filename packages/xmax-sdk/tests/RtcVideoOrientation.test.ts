import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraPosition } from "../src/Foundation/Media/Camera/CameraPosition";
import { RtcEngineManager, type RtcEngine } from "../src/Foundation/RTC/RtcEngineManager";
import { RtcManager } from "../src/Foundation/RTC/RtcManager";
import {
  rtcOrientedVideoSize,
  shouldTransposeRtcVideoSize,
} from "../src/Foundation/RTC/RtcVideoOrientation";
import { RtcVideoEncoderPreference } from "../src/Foundation/RTC/VideoEncodingConfiguration";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("shouldTransposeRtcVideoSize", () => {
  it("transposes only on mobile in portrait orientation", () => {
    expect(
      shouldTransposeRtcVideoSize({ userAgent: IPHONE_UA, orientationType: "portrait-primary" }),
    ).toBe(true);
    expect(
      shouldTransposeRtcVideoSize({ userAgent: ANDROID_UA, orientationType: "portrait-secondary" }),
    ).toBe(true);
    // 桌面 UA 的 iPad 通过触控点数识别。
    expect(
      shouldTransposeRtcVideoSize({
        userAgent: IPAD_DESKTOP_UA,
        maxTouchPoints: 5,
        orientationType: "portrait-primary",
      }),
    ).toBe(true);

    expect(
      shouldTransposeRtcVideoSize({ userAgent: IPHONE_UA, orientationType: "landscape-primary" }),
    ).toBe(false);
    expect(
      shouldTransposeRtcVideoSize({ userAgent: DESKTOP_UA, orientationType: "portrait-primary" }),
    ).toBe(false);
    expect(
      shouldTransposeRtcVideoSize({ userAgent: DESKTOP_UA, orientationType: "landscape-primary" }),
    ).toBe(false);
  });

  it("falls back to legacy window.orientation degrees", () => {
    expect(
      shouldTransposeRtcVideoSize({ userAgent: IPHONE_UA, orientationDegrees: 0 }),
    ).toBe(true);
    expect(
      shouldTransposeRtcVideoSize({ userAgent: IPHONE_UA, orientationDegrees: 180 }),
    ).toBe(true);
    expect(
      shouldTransposeRtcVideoSize({ userAgent: IPHONE_UA, orientationDegrees: 90 }),
    ).toBe(false);
  });

  it("swaps width and height only when transposing", () => {
    expect(
      rtcOrientedVideoSize(
        { width: 1024, height: 1920 },
        { userAgent: IPHONE_UA, orientationType: "portrait-primary" },
      ),
    ).toEqual({ width: 1920, height: 1024 });
    expect(
      rtcOrientedVideoSize(
        { width: 1024, height: 1920 },
        { userAgent: DESKTOP_UA, orientationType: "portrait-primary" },
      ),
    ).toEqual({ width: 1024, height: 1920 });
  });
});

describe("RtcManager video orientation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeManager() {
    const calls: { startLocalVideo: unknown[]; updateLocalVideo: unknown[] } = {
      startLocalVideo: [],
      updateLocalVideo: [],
    };
    const engine = {
      on: () => {},
      off: () => {},
      startLocalVideo: async (config: unknown) => {
        calls.startLocalVideo.push(config);
      },
      updateLocalVideo: async (config: unknown) => {
        calls.updateLocalVideo.push(config);
      },
      stopLocalVideo: async () => {},
      getVideoTrack: () => ({ id: "track" }) as unknown as MediaStreamTrack,
      destroy: () => {},
    };
    const manager = new RtcManager(
      new RtcEngineManager(async () => engine as unknown as RtcEngine),
    );
    return { manager, calls };
  }

  function stubMobilePortrait() {
    vi.stubGlobal("navigator", { userAgent: IPHONE_UA, maxTouchPoints: 5 });
    vi.stubGlobal("window", { screen: { orientation: { type: "portrait-primary" } } });
  }

  it("transposes capture and encoding profiles on mobile portrait", async () => {
    stubMobilePortrait();
    const { manager, calls } = makeManager();
    await manager.initialize();

    await manager.startCameraCapture({
      width: 1024,
      height: 1920,
      frameRate: 30,
      position: CameraPosition.front,
    });
    expect(calls.startLocalVideo[0]).toMatchObject({
      option: { profile: { width: 1920, height: 1024 } },
    });

    await manager.configureVideoEncoding({
      width: 1024,
      height: 1920,
      frameRate: 30,
      minimumBitrate: 800,
      maximumBitrate: 2400,
      encoderPreference: RtcVideoEncoderPreference.maintainQuality,
    });
    expect(calls.updateLocalVideo[0]).toMatchObject({
      option: { profile: { width: 1920, height: 1024 } },
    });

    await manager.destroy();
  });

  it("keeps profiles as-is on desktop", async () => {
    const { manager, calls } = makeManager();
    await manager.initialize();

    await manager.startCameraCapture({
      width: 1920,
      height: 1024,
      frameRate: 30,
      position: CameraPosition.front,
    });
    expect(calls.startLocalVideo[0]).toMatchObject({
      option: { profile: { width: 1920, height: 1024 } },
    });

    await manager.destroy();
  });
});
