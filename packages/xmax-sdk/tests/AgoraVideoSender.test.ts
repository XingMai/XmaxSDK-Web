import { afterEach, describe, expect, it, vi } from "vitest";
import type { ILocalVideoTrack } from "agora-rtc-sdk-ng";
import { AgoraVideoSender } from "../src/Foundation/RTC/Agora/AgoraVideoSender";
import { RtcVideoEncoderPreference } from "../src/Foundation/RTC/VideoEncodingConfiguration";

const config = { width: 960, height: 512, frameRate: 24, minimumBitrate: 1000, maximumBitrate: 2000,
  encoderPreference: RtcVideoEncoderPreference.maintainFramerate };

function setup() {
  let parameters = { transactionId: "native", codecs: [], headerExtensions: [], rtcp: {},
    encodings: [{ active: true, rid: "main", scaleResolutionDownBy: 1, maxFramerate: 30, maxBitrate: 6000000 }],
  } as RTCRtpSendParameters;
  const native = { getSettings: vi.fn(() => ({ width: 1920, height: 1024, frameRate: 30 })), applyConstraints: vi.fn() };
  const sender = { track: native,
    getParameters: vi.fn(() => structuredClone(parameters)),
    setParameters: vi.fn(async (next: RTCRtpSendParameters) => { parameters = structuredClone(next); }),
  };
  const track = { getRTCRtpTransceiver: vi.fn((): unknown => ({ sender })), setEncoderConfiguration: vi.fn() };
  return { sender, native, track, apply: (next = config, ensureActive = () => {}) =>
    AgoraVideoSender.apply(track as unknown as ILocalVideoTrack, next, ensureActive) };
}

afterEach(() => vi.restoreAllMocks());

describe("AgoraVideoSender", () => {
  it("updates only sending limits, preserves negotiated fields, and scales from capture each time", async () => {
    const s = setup();
    await s.apply();
    expect(s.sender.getParameters()).toMatchObject({ transactionId: "native", degradationPreference: "maintain-framerate",
      encodings: [{ rid: "main", active: true, scaleResolutionDownBy: 2, maxFramerate: 24, maxBitrate: 2000000 }],
    });
    await s.apply({ ...config, width: 480, height: 256, frameRate: 16 });
    expect(s.sender.getParameters().encodings[0]!.scaleResolutionDownBy).toBe(4);
    await s.apply({ ...config, width: 1920, height: 1024, frameRate: 30 });
    expect(s.sender.getParameters().encodings[0]!.scaleResolutionDownBy).toBe(1);
    expect(s.native.applyConstraints).not.toHaveBeenCalled();
    expect(s.track.setEncoderConfiguration).not.toHaveBeenCalled();
    expect(s.sender.getParameters().encodings[0]).not.toHaveProperty("minBitrate");
  });

  it("fits within requested bounds without trying to upscale the camera", async () => {
    const s = setup();
    await s.apply({ ...config, width: 3840, height: 2048 });
    expect(s.sender.getParameters().encodings[0]!.scaleResolutionDownBy).toBe(1);
    await s.apply({ ...config, width: 960, height: 256 });
    expect(s.sender.getParameters().encodings[0]!.scaleResolutionDownBy).toBe(4);
  });

  it("rejects absent senders or missing capture dimensions", async () => {
    const s = setup();
    s.track.getRTCRtpTransceiver.mockReturnValueOnce(undefined);
    await expect(s.apply()).rejects.toThrow("sender is unavailable");
    s.native.getSettings.mockReturnValueOnce({ width: 0, height: 0, frameRate: 30 });
    await expect(s.apply()).rejects.toThrow("dimensions are unavailable");
    expect(s.sender.setParameters).not.toHaveBeenCalled();
  });

  it.each([0, 2])("does not invent or overwrite encodings when their count is %s", async count => {
    const s = setup();
    s.sender.getParameters.mockReturnValueOnce({ ...s.sender.getParameters(), encodings: Array.from({ length: count }, () => ({})) });
    await expect(s.apply()).rejects.toThrow("requires one video encoding");
    expect(s.sender.setParameters).not.toHaveBeenCalled();
  });

  it("reports rejected updates without falling back to camera configuration", async () => {
    const s = setup();
    s.sender.setParameters.mockRejectedValueOnce(new Error("unsupported"));
    await expect(s.apply()).rejects.toThrow("unsupported");
    expect(s.native.applyConstraints).not.toHaveBeenCalled();
    expect(s.track.setEncoderConfiguration).not.toHaveBeenCalled();
  });

  it("detects silently ignored parameters and attempts to restore the previous limits", async () => {
    const s = setup();
    const previous = s.sender.getParameters();
    s.sender.setParameters.mockImplementationOnce(async () => {});
    await expect(s.apply()).rejects.toThrow("did not retain");
    expect(s.sender.setParameters).toHaveBeenCalledTimes(2);
    expect(s.sender.getParameters()).toEqual(previous);
    expect(s.native.applyConstraints).not.toHaveBeenCalled();
  });

  it("does not accept a late result after cancellation or sender replacement", async () => {
    const s = setup();
    const ensure = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error("cancelled"); });
    await expect(s.apply(config, ensure)).rejects.toThrow("cancelled");
    s.track.getRTCRtpTransceiver.mockReturnValueOnce({ sender: s.sender }).mockReturnValueOnce(undefined);
    await expect(s.apply()).rejects.toThrow("sender changed");
  });
});
