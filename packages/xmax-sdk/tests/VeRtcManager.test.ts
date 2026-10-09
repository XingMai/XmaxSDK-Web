import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VeRtcManager, VERTC_APP_ID } from "../src/Foundation/RTC/VeRTC/VeRtcManager";
import { CameraPosition } from "../src/Foundation/Media/Camera/CameraPosition";
import { RtcVideoEncoderPreference } from "../src/Foundation/RTC/VideoEncodingConfiguration";
import type { VeRtcRoomJoinConfiguration } from "../src/Foundation/RTC/RoomJoinConfiguration";

type SDK = typeof import("@volcengine/rtc");
const credentials: VeRtcRoomJoinConfiguration = { provider: RtcProvider.vertc, appID: VERTC_APP_ID, roomID: "000123", userID: "ve-user", roomToken: "secret-v1" };
const managers: VeRtcManager[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}

function setup() {
  const handlers = new Map<string, (...args: any[]) => void>();
  const native = { kind: "video" } as MediaStreamTrack;
  const remote = { kind: "video", id: "remote" } as MediaStreamTrack;
  const audio = { kind: "audio" } as MediaStreamTrack;
  const players: any[] = [];
  vi.stubGlobal("document", { createElement: vi.fn(() => {
    const player = { srcObject: null, volume: 1, muted: false, pause: vi.fn(), play: vi.fn(async () => {}) };
    players.push(player); return player;
  }) });
  vi.stubGlobal("MediaStream", class { constructor(public tracks: MediaStreamTrack[]) {} });
  const engine = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => handlers.set(event, handler)), removeAllListeners: vi.fn(),
    setVideoEncoderConfig: vi.fn(async (_config: unknown) => {}), startVideoCapture: vi.fn(async () => ({})), stopVideoCapture: vi.fn(async () => {}),
    setVideoCaptureDevice: vi.fn(async () => {}), startAudioCapture: vi.fn(async () => ({})), stopAudioCapture: vi.fn(async () => {}),
    getLocalStreamTrack: vi.fn(() => native), getRemoteStreamTrack: vi.fn((_user: string, _index: number, kind: string) => kind === "audio" ? audio : remote),
    joinRoom: vi.fn(async () => {}), leaveRoom: vi.fn(async () => {}), updateToken: vi.fn(async (_token: string) => {}),
    publishStream: vi.fn(async (_type: number) => {}), unpublishStream: vi.fn(async (_type: number) => {}),
    subscribeStream: vi.fn(async (_user: string, _type: number) => {}), unsubscribeStream: vi.fn(async (_user: string, _type: number) => {}),
    sendRoomMessage: vi.fn(async (_message: string) => "message-id"),
  };
  const sdk = {
    default: { createEngine: vi.fn(() => engine), destroyEngine: vi.fn(), setLogConfig: vi.fn(), events: new Proxy({}, { get: (_, name) => name }) },
    RTCAutoPlayPolicy: { PLAY_MANUALLY: 2 }, VideoCodecType: { H264: "H264" }, MediaType: { AUDIO: 1, VIDEO: 2, AUDIO_AND_VIDEO: 3 },
    StreamIndex: { STREAM_INDEX_MAIN: 0 }, RoomProfileType: { communication: "communication" }, ConnectionState: { CONNECTION_STATE_RECONNECTED: 5 },
  };
  const loadSDK = vi.fn(async () => sdk as unknown as SDK);
  const manager = new VeRtcManager({ loadSDK }); managers.push(manager);
  const listener = { onRemoteVideoPublished: vi.fn(), onCustomMessageReceived: vi.fn(), onTokenExpired: vi.fn(), onTokenWillExpire: vi.fn(),
    onRoomRejoining: vi.fn(), onError: vi.fn(), onNetworkStatistics: vi.fn(), onLocalVideoStatistics: vi.fn(), onRemoteVideoStatistics: vi.fn() };
  manager.setEventListener(listener);
  const emit = (event: string, ...args: unknown[]) => handlers.get(event)?.(...args);
  const joined = async () => { await manager.initialize(); await manager.joinRoom(credentials); };
  const capture = () => manager.startCameraCapture({ width: 1024, height: 1920, frameRate: 30, position: CameraPosition.front });
  return { manager, engine, sdk, native, remote, audio, loadSDK, listener, emit, joined, capture, players };
}

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.destroy();
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("VeRTC media and protocol", () => {
  it("loads once, creates the fixed AppID engine and disables automatic playback", async () => {
    const s = setup(); expect(s.loadSDK).not.toHaveBeenCalled();
    await Promise.all([s.manager.initialize(), s.manager.initialize()]);
    expect(s.loadSDK).toHaveBeenCalledOnce();
    expect(s.sdk.default.createEngine).toHaveBeenCalledWith(VERTC_APP_ID, { autoPlayPolicy: 2 });
    await s.manager.destroy();
    expect(s.sdk.default.destroyEngine).toHaveBeenCalledWith(s.engine);
    expect(s.manager.isInitialized).toBe(false);
  });

  it("does not resurrect when destroyed during module loading", async () => {
    const s = setup(), loading = deferred<SDK>(); s.loadSDK.mockReturnValueOnce(loading.promise);
    const result = expect(s.manager.initialize()).rejects.toMatchObject({ code: "CANCELLED" });
    await s.manager.destroy(); loading.resolve(s.sdk as unknown as SDK); await result;
    expect(s.sdk.default.createEngine).not.toHaveBeenCalled();
  });

  it("uses SDK capture without publishing, switches and keeps capture when unpublishing", async () => {
    const s = setup(); await s.joined(); expect(await s.capture()).toBe(s.native);
    expect(s.engine.startVideoCapture).toHaveBeenCalledWith("user");
    expect(s.engine.publishStream).not.toHaveBeenCalled();
    expect(await s.manager.switchCameraCapture(CameraPosition.back)).toBe(s.native);
    expect(s.engine.setVideoCaptureDevice).toHaveBeenCalledWith("environment");
    await s.manager.configureVideoEncoding({ width: 1920, height: 1024, frameRate: 30, minimumBitrate: 4000, maximumBitrate: 8000, encoderPreference: RtcVideoEncoderPreference.maintainFramerate });
    expect(s.engine.setVideoEncoderConfig).toHaveBeenLastCalledWith({ width: 1920, height: 1024, frameRate: 30, maxKbps: 8000, preferCodecName: "H264", contentHint: "motion" });
    await s.manager.publishLocalVideo(); await s.manager.unpublishLocalVideo();
    expect(s.engine.stopVideoCapture).not.toHaveBeenCalled();
    await s.manager.stopCameraCapture(); expect(s.engine.stopVideoCapture).toHaveBeenCalledOnce();
  });

  it("transposes mobile portrait capture dimensions", async () => {
    const s = setup();
    vi.stubGlobal("navigator", { userAgent: "iPhone", maxTouchPoints: 1 });
    vi.stubGlobal("window", { screen: { orientation: { type: "portrait-primary" } } });
    await s.manager.initialize(); await s.capture();
    expect(s.engine.setVideoEncoderConfig).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1024 }));
  });

  it("stops a late capture after cancellation", async () => {
    const s = setup(), capture = deferred<MediaTrackSettings>(); await s.manager.initialize();
    s.engine.startVideoCapture.mockReturnValueOnce(capture.promise);
    const result = expect(s.capture()).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(s.engine.startVideoCapture).toHaveBeenCalled());
    await s.manager.stopCameraCapture(); capture.resolve({}); await result;
    expect(s.engine.stopVideoCapture).toHaveBeenCalledTimes(2);
  });

  it("rejects an unexpected AppID before calling the vendor", async () => {
    const s = setup(); await s.manager.initialize();
    await expect(s.manager.joinRoom({ ...credentials, appID: "other" })).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(s.engine.joinRoom).not.toHaveBeenCalled();
  });

  it("replays bot publications received while joining and returns the native subscribed track", async () => {
    const s = setup(); s.engine.joinRoom.mockImplementationOnce(async () => { s.emit("onUserPublishStream", { userId: "bot", mediaType: 3 }); });
    await s.joined();
    expect(s.engine.joinRoom).toHaveBeenCalledWith("secret-v1", "000123", { userId: "ve-user" }, { isAutoPublish: false, isAutoSubscribeAudio: false, isAutoSubscribeVideo: false, roomProfileType: "communication" });
    expect(s.listener.onRemoteVideoPublished).toHaveBeenCalledWith("bot", true);
    expect(await s.manager.subscribeRemoteVideo("bot", true)).toBe(s.remote);
    s.emit("onUserUnpublishStream", { userId: "bot", mediaType: 2 });
    expect(s.listener.onRemoteVideoPublished).toHaveBeenLastCalledWith("bot", false);
  });

  it("sends the entire UTF-8 room message and ignores non-text inbound data", async () => {
    const s = setup(); await s.joined();
    const message = JSON.stringify({ event: "change_condition", prompt: "场景".repeat(1500) });
    await s.manager.sendRoomMessage(message);
    expect(s.engine.sendRoomMessage).toHaveBeenCalledOnce(); expect(s.engine.sendRoomMessage).toHaveBeenCalledWith(message);
    s.emit("onRoomMessageReceived", { userId: "bot", message });
    expect(s.listener.onCustomMessageReceived).toHaveBeenCalledWith("bot", message);
    s.emit("onRoomMessageReceived", { userId: "bot", message: { event: "change_condition" } });
    expect(s.listener.onCustomMessageReceived).toHaveBeenCalledOnce();
    await expect(s.manager.sendRoomMessage("中".repeat(22000))).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(s.engine.sendRoomMessage).toHaveBeenCalledOnce();
  });

  it.each(["leave", "timeout"])("releases pending message waits on %s", async (action) => {
    vi.useFakeTimers(); const s = setup(); await s.joined();
    const sending = deferred<string>(); s.engine.sendRoomMessage.mockReturnValueOnce(sending.promise);
    const result = expect(s.manager.sendRoomMessage("{}")).rejects.toMatchObject({ code: action === "leave" ? "CANCELLED" : "TIMEOUT" });
    if (action === "leave") await s.manager.leaveRoom(); else await vi.advanceTimersByTimeAsync(5000);
    await result; sending.resolve("late"); expect(vi.getTimerCount()).toBe(0);
  });

  it("holds audio muted until activation and handles audio published after video", async () => {
    const s = setup(); await s.joined(); await s.manager.subscribeRemoteAudio("bot", true);
    expect(s.engine.subscribeStream).not.toHaveBeenCalled();
    s.emit("onUserPublishStream", { userId: "bot", mediaType: 1 });
    await vi.waitFor(() => expect(s.players).toHaveLength(1));
    expect(s.players[0].muted).toBe(true); expect(s.players[0].play).not.toHaveBeenCalled();
    s.manager.setRemoteAudioVolume(30, "bot");
    expect(s.players[0].muted).toBe(false); expect(s.players[0].volume).toBe(0.3); expect(s.players[0].play).toHaveBeenCalled();
    s.manager.setRemoteAudioVolume(0, "bot"); expect(s.players[0].muted).toBe(true);
    await s.manager.leaveRoom(); expect(s.players[0].srcObject).toBeNull();
  });

  it("never plays a late audio subscription after unsubscription", async () => {
    const s = setup(); await s.joined(); s.emit("onUserPublishStream", { userId: "bot", mediaType: 1 });
    s.manager.setRemoteAudioVolume(100, "bot");
    const subscribing = deferred<void>(); s.engine.subscribeStream.mockReturnValueOnce(subscribing.promise);
    const pending = s.manager.subscribeRemoteAudio("bot", true);
    await s.manager.subscribeRemoteAudio("bot", false); subscribing.resolve(); await pending;
    expect(s.players).toHaveLength(0);
  });

  it("maps permission denial but never exposes raw vendor errors or tokens", async () => {
    const s = setup(); await s.joined();
    s.engine.startVideoCapture.mockRejectedValueOnce({ name: "NotAllowedError", message: "secret-v1" });
    await expect(s.capture()).rejects.toMatchObject({ code: "CAMERA_PERMISSION_DENIED", message: "VeRTC operation failed (UNKNOWN)" });
    s.emit("onError", { errorCode: "DUPLICATE_LOGIN", message: "secret-v1" });
    expect(s.listener.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "RTC_ERROR", message: "VeRTC operation failed (DUPLICATE_LOGIN)" }));
  });
});

describe("VeRTC token recovery", () => {
  it("updates tokens online without rejoining and bridges expiry warnings", async () => {
    const s = setup(); await s.joined();
    s.emit("onTokenWillExpire"); s.emit("onTokenPublishPrivilegeWillExpire"); s.emit("onTokenSubscribePrivilegeWillExpire");
    expect(s.listener.onTokenWillExpire).toHaveBeenCalledTimes(3);
    await s.manager.updateCredentials({ ...credentials, roomToken: "secret-v2" });
    expect(s.engine.updateToken).toHaveBeenCalledWith("secret-v2"); expect(s.engine.joinRoom).toHaveBeenCalledOnce();
    await expect(s.manager.updateCredentials({ ...credentials, roomID: "other" })).rejects.toMatchObject({ code: "SESSION_ERROR" });
  });

  it("rejoins after token expiry, restores publication and preserves remote audio intent", async () => {
    const s = setup(); await s.joined(); await s.capture(); await s.manager.publishLocalVideo(); await s.manager.publishLocalAudio();
    s.emit("onUserPublishStream", { userId: "bot", mediaType: 3 });
    await s.manager.subscribeRemoteAudio("bot", true); s.manager.setRemoteAudioVolume(40, "bot");
    s.emit("onError", { errorCode: "TOKEN_EXPIRED" }); s.emit("onError", { errorCode: "TOKEN_EXPIRED" });
    expect(s.listener.onTokenExpired).toHaveBeenCalledOnce(); expect(s.listener.onError).not.toHaveBeenCalled();
    s.engine.joinRoom.mockImplementationOnce(async () => { s.emit("onUserPublishStream", { userId: "bot", mediaType: 3 }); });
    await s.manager.updateCredentials({ ...credentials, roomToken: "secret-v2" });
    expect(s.engine.updateToken).not.toHaveBeenCalled(); expect(s.engine.joinRoom).toHaveBeenCalledTimes(2);
    expect(s.listener.onRoomRejoining).toHaveBeenCalledOnce();
    expect(s.engine.publishStream.mock.calls.map(args => args[0])).toEqual([2, 1, 2, 1]);
    expect(s.players.at(-1).volume).toBe(0.4); expect(s.players.at(-1).play).toHaveBeenCalled();
    expect(s.engine.startVideoCapture).toHaveBeenCalledOnce(); expect(s.engine.startAudioCapture).toHaveBeenCalledOnce();
  });

  it.each(["Publish", "Subscribe"])("recovers %s privilege expiry without unnecessarily rejoining", async (kind) => {
    const s = setup(); await s.joined(); await s.capture(); await s.manager.publishLocalVideo();
    s.emit(`onToken${kind}PrivilegeDidExpired`, {});
    await s.manager.updateCredentials({ ...credentials, roomToken: "new" });
    expect(s.engine.updateToken).toHaveBeenCalledWith("new"); expect(s.engine.joinRoom).toHaveBeenCalledOnce();
    expect(s.engine.publishStream).toHaveBeenCalledTimes(kind === "Publish" ? 2 : 1);
  });

  it("upgrades an online renewal that races with expiry to rejoin", async () => {
    const s = setup(); await s.joined(); const updating = deferred<void>(); s.engine.updateToken.mockReturnValueOnce(updating.promise);
    const pending = s.manager.updateCredentials({ ...credentials, roomToken: "new" });
    s.emit("onError", { errorCode: "TOKEN_EXPIRED" }); updating.reject(new Error("expired secret"));
    await pending; expect(s.engine.joinRoom).toHaveBeenCalledTimes(2);
  });

  it("cancels stalled rejoin immediately and releases a late successful join", async () => {
    const s = setup(); await s.joined(); await s.capture(); await s.manager.publishLocalVideo();
    s.emit("onError", { errorCode: "TOKEN_EXPIRED" });
    const joining = deferred<void>(); s.engine.joinRoom.mockReturnValueOnce(joining.promise);
    const abort = new AbortController();
    const result = expect(s.manager.updateCredentials({ ...credentials, roomToken: "new" }, abort.signal)).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(s.engine.joinRoom).toHaveBeenCalledTimes(2));
    abort.abort(); await result; await s.manager.leaveRoom();
    const leaveCount = s.engine.leaveRoom.mock.calls.length;
    joining.resolve(); await vi.waitFor(() => expect(s.engine.leaveRoom).toHaveBeenCalledTimes(leaveCount + 1));
    expect(s.engine.publishStream).toHaveBeenCalledOnce();
  });

  it("leaves network reconnection to VeRTC and rebinds remote tracks on recovery", async () => {
    const s = setup(); await s.joined(); s.emit("onUserPublishStream", { userId: "bot", mediaType: 2 });
    s.emit("onConnectionStateChanged", { state: 4 }); s.emit("onConnectionStateChanged", { state: 5 });
    expect(s.engine.joinRoom).toHaveBeenCalledOnce(); expect(s.listener.onRoomRejoining).toHaveBeenCalledOnce();
    expect(s.listener.onRemoteVideoPublished).toHaveBeenLastCalledWith("bot", true);
    expect(s.listener.onError).not.toHaveBeenCalled();
  });
});

describe("VeRTC statistics", () => {
  it("normalizes units, excludes screen streams and clears departed statistics", async () => {
    const s = setup(); await s.joined(); await s.capture(); await s.manager.publishLocalVideo(); await s.manager.subscribeRemoteVideo("bot", true);
    s.emit("onLocalStreamStats", { isScreen: false, videoStats: { encodedFrameWidth: 1920, encodedFrameHeight: 1024, sentFrameRate: 30, sentKBitrate: 4500, videoLossRate: 0.02 } });
    expect(s.listener.onLocalVideoStatistics).toHaveBeenLastCalledWith({ width: 1920, height: 1024, frameRate: 30, bitrateKbps: 4500, uplinkLossPercent: 2 });
    s.emit("onRemoteStreamStats", { userId: "bot", isScreen: false, videoStats: { width: 1920, height: 1024, receivedKBitrate: 4000, decoderOutputFrameRate: 25, videoLossRate: 0.03, rtt: 10, totalRtt: 50, e2eDelay: 90 } });
    expect(s.listener.onRemoteVideoStatistics).toHaveBeenLastCalledWith([{ userID: "bot", width: 1920, height: 1024, frameRate: 25, bitrateKbps: 4000, uplinkLossPercent: 2, downlinkLossPercent: 3, rttMs: 10, endToEndDelayMs: 90 }]);
    const count = s.listener.onRemoteVideoStatistics.mock.calls.length;
    s.emit("onRemoteStreamStats", { userId: "screen", isScreen: true, videoStats: {} });
    expect(s.listener.onRemoteVideoStatistics).toHaveBeenCalledTimes(count);
    s.emit("onNetworkQuality", 2, 3); expect(s.listener.onNetworkStatistics).toHaveBeenCalledWith({ uplinkQuality: 2, downlinkQuality: 3 });
    s.emit("onUserLeave", { userInfo: { userId: "bot" } }); expect(s.listener.onRemoteVideoStatistics).toHaveBeenLastCalledWith([]);
  });
});

describe("VeRTC overlapping operations", () => {
  it("does not let an old join cleanup disconnect a new room", async () => {
    const s = setup(); await s.manager.initialize();
    const joining = deferred<void>(), leaving = deferred<void>();
    s.engine.joinRoom.mockReturnValueOnce(joining.promise);
    const first = expect(s.manager.joinRoom(credentials)).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(s.engine.joinRoom).toHaveBeenCalledOnce());
    await s.manager.leaveRoom();
    s.engine.leaveRoom.mockReturnValueOnce(leaving.promise);
    const next = s.manager.joinRoom({ ...credentials, roomID: "next" });
    joining.resolve(); await vi.waitFor(() => expect(s.engine.leaveRoom).toHaveBeenCalledTimes(2));
    expect(s.engine.joinRoom).toHaveBeenCalledOnce();
    leaving.resolve(); await first; await next; expect(s.engine.joinRoom).toHaveBeenCalledTimes(2);
  });

  it("does not replay stale audio when an old subscription resolves during token recovery", async () => {
    const s = setup(); await s.joined(); s.emit("onUserPublishStream", { userId: "bot", mediaType: 1 });
    s.manager.setRemoteAudioVolume(100, "bot");
    const subscribing = deferred<void>(); s.engine.subscribeStream.mockReturnValueOnce(subscribing.promise);
    const pending = s.manager.subscribeRemoteAudio("bot", true);
    s.emit("onError", { errorCode: "TOKEN_EXPIRED" }); subscribing.resolve(); await pending;
    expect(s.players).toHaveLength(0);
  });

  it("honors unpublish requested while recovery is republishing", async () => {
    const s = setup(); await s.joined(); await s.capture(); await s.manager.publishLocalVideo();
    s.emit("onError", { errorCode: "TOKEN_EXPIRED" });
    const publishing = deferred<void>(); s.engine.publishStream.mockReturnValueOnce(publishing.promise);
    const renewing = s.manager.updateCredentials({ ...credentials, roomToken: "new" });
    await vi.waitFor(() => expect(s.engine.publishStream).toHaveBeenCalledTimes(2));
    await s.manager.unpublishLocalVideo(); publishing.resolve(); await renewing;
    expect(s.engine.unpublishStream).toHaveBeenLastCalledWith(2);
  });
});
