import { afterEach, describe, expect, it, vi } from "vitest";
import type { IAgoraRTC, IAgoraRTCRemoteUser } from "agora-rtc-sdk-ng";
import { AgoraRtcManager } from "../src/Foundation/RTC/Agora/AgoraRtcManager";
import { XmaxEnvironment } from "../src/Foundation/Runtime/XmaxEnvironment";
import { CameraPosition } from "../src/Foundation/Media/Camera/CameraPosition";
import { RtcVideoEncoderPreference } from "../src/Foundation/RTC/VideoEncodingConfiguration";
import type { AgoraRoomJoinConfiguration } from "../src/Foundation/RTC/RoomJoinConfiguration";
import { StreamController } from "../src/Stream/StreamController";
import { RoomController } from "../src/Stream/Room/RoomController";
import { RoomHeartbeat } from "../src/Stream/Room/RoomHeartbeat";
import { RealtimeContext } from "../src/Service/Realtime/RealtimeContext";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";

const credentials: AgoraRoomJoinConfiguration = { provider: "agora", appID: "app", roomID: "000123", userID: "rtc-user", roomToken: "secret" };
const managers: AgoraRtcManager[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(environment = XmaxEnvironment.china) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const native = { kind: "video" } as MediaStreamTrack;
  const camera = { getMediaStreamTrack: vi.fn(() => native), close: vi.fn(), setDevice: vi.fn(async () => {}),
    setEncoderConfiguration: vi.fn(async () => {}), setOptimizationMode: vi.fn(async () => {}) };
  const microphone = { close: vi.fn() };
  const audio = { play: vi.fn(), stop: vi.fn(), setVolume: vi.fn() };
  const user = { uid: "bot", hasAudio: true, hasVideo: true, audioTrack: audio } as unknown as IAgoraRTCRemoteUser;
  const client = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => { handlers.set(event, handler); }),
    removeAllListeners: vi.fn(), join: vi.fn(async () => "rtc-user"), leave: vi.fn(async () => {}),
    publish: vi.fn(async () => {}), unpublish: vi.fn(async () => {}),
    subscribe: vi.fn(async (_user: unknown, kind: string): Promise<any> => kind === "audio" ? audio : camera),
    unsubscribe: vi.fn(async () => {}), renewToken: vi.fn(async () => {}),
    sendStreamMessage: vi.fn(async (_message: string, _retry: boolean) => {}),
    remoteUsers: [user], localTracks: [{ trackMediaType: "video" }],
    getRTCStats: vi.fn(() => ({ RTT: 12, SendBytes: 100, RecvBytes: 200 })),
    getLocalVideoStats: vi.fn(() => ({ sendResolutionWidth: 1920, sendResolutionHeight: 1024, sendFrameRate: 30, sendBitrate: 6000000, currentPacketLossRate: 0.02 })),
    getRemoteVideoStats: vi.fn(() => ({ bot: { receiveResolutionWidth: 1920, receiveResolutionHeight: 1024, receiveFrameRate: 25, receiveBitrate: 5000000, currentPacketLossRate: 0.03, end2EndDelay: 90, receiveDelay: 120, transportDelay: 80 } })),
    getLocalAudioStats: vi.fn(() => ({})), getRemoteAudioStats: vi.fn(() => ({})),
  };
  const sdk = { setArea: vi.fn(), setLogLevel: vi.fn(), createClient: vi.fn(() => client),
    createCameraVideoTrack: vi.fn(async () => camera), createMicrophoneAudioTrack: vi.fn(async () => microphone) };
  const loadSDK = vi.fn(async () => sdk as unknown as IAgoraRTC);
  const manager = new AgoraRtcManager({ environment, loadSDK });
  managers.push(manager);
  const listener = { onRemoteVideoPublished: vi.fn(), onCustomMessageReceived: vi.fn(), onTokenExpired: vi.fn(),
    onTokenWillExpire: vi.fn(), onRoomRejoining: vi.fn(),
    onNetworkStatistics: vi.fn(), onLocalVideoStatistics: vi.fn(), onRemoteVideoStatistics: vi.fn(), onError: vi.fn() };
  manager.setEventListener(listener);
  return { manager, client, sdk, loadSDK, camera, microphone, native, audio, user, listener, emit: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args) };
}

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AgoraRtcManager", () => {
  it.each([[XmaxEnvironment.china, "CHINA"], [XmaxEnvironment.global, "GLOBAL"]])("loads lazily and maps %s to %s", async (environment, region) => {
    const s = setup(environment as XmaxEnvironment);
    expect(s.loadSDK).not.toHaveBeenCalled();
    await Promise.all([s.manager.initialize(), s.manager.initialize()]);
    expect(s.loadSDK).toHaveBeenCalledOnce();
    expect(s.sdk.setArea).toHaveBeenCalledWith([region]);
    expect(s.sdk.createClient).toHaveBeenCalledWith({ mode: "rtc", codec: "h264" });
    expect(s.sdk.setLogLevel).toHaveBeenCalledWith(4);
  });

  it("prevents conflicting global areas from silently affecting another client", async () => {
    const s = setup();
    await s.manager.initialize();
    const other = new AgoraRtcManager({ environment: XmaxEnvironment.global, loadSDK: s.loadSDK });
    managers.push(other);
    await expect(other.initialize()).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await s.manager.destroy();
    await other.initialize();
    expect(s.sdk.setArea).toHaveBeenLastCalledWith(["GLOBAL"]);
  });

  it("does not resurrect after destroy during module loading", async () => {
    const s = setup();
    const loading = deferred<IAgoraRTC>();
    s.loadSDK.mockReturnValueOnce(loading.promise);
    const initializing = s.manager.initialize();
    const rejected = expect(initializing).rejects.toMatchObject({ code: "CANCELLED" });
    await s.manager.destroy();
    loading.resolve(s.sdk as unknown as IAgoraRTC);
    await rejected;
    expect(s.sdk.createClient).not.toHaveBeenCalled();
  });

  it("captures without publishing and preserves requested dimensions without a mobile orientation", async () => {
    const s = setup();
    await s.manager.initialize();
    expect(await s.manager.startCameraCapture({ width: 1024, height: 1920, frameRate: 30, position: CameraPosition.front })).toBe(s.native);
    expect(s.sdk.createCameraVideoTrack).toHaveBeenCalledWith({ facingMode: "user", encoderConfig: { width: 1024, height: 1920, frameRate: 30 } });
    expect(s.client.publish).not.toHaveBeenCalled();
    await s.manager.configureVideoEncoding({ width: 1024, height: 1920, frameRate: 30, minimumBitrate: 3000, maximumBitrate: 6000, encoderPreference: RtcVideoEncoderPreference.maintainFramerate });
    expect(s.camera.setEncoderConfiguration).toHaveBeenCalledWith({ width: 1024, height: 1920, frameRate: 30, bitrateMin: 3000, bitrateMax: 6000 });
    expect(s.camera.setOptimizationMode).toHaveBeenCalledWith("motion");
    await s.manager.switchCameraCapture(CameraPosition.back);
    expect(s.camera.setDevice).toHaveBeenCalledWith({ facingMode: "environment" });
    await s.manager.publishLocalVideo();
    await s.manager.unpublishLocalVideo();
    expect(s.camera.close).not.toHaveBeenCalled();
    await s.manager.stopCameraCapture();
    expect(s.camera.close).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "iPhone portrait", userAgent: "iPhone", maxTouchPoints: 5, orientation: "portrait-primary", transpose: true },
    { name: "Android portrait", userAgent: "Android", maxTouchPoints: 5, orientation: "portrait-secondary", transpose: true },
    { name: "iPad desktop UA portrait", userAgent: "Macintosh", maxTouchPoints: 5, orientation: "portrait-primary", transpose: true },
    { name: "mobile landscape", userAgent: "iPhone", maxTouchPoints: 5, orientation: "landscape-primary", transpose: false },
    { name: "desktop", userAgent: "Macintosh", maxTouchPoints: 0, orientation: "portrait-primary", transpose: false },
  ])("applies capture and encoding orientation consistently on $name", async ({ userAgent, maxTouchPoints, orientation, transpose }) => {
    vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
    vi.stubGlobal("window", { screen: { orientation: { type: orientation } } });
    const s = setup();
    await s.manager.initialize();

    const requestedSize = { width: 1024, height: 1920 };
    const expectedSize = transpose ? { width: 1920, height: 1024 } : requestedSize;
    const capture = { ...requestedSize, frameRate: 30, position: CameraPosition.front };
    expect(await s.manager.startCameraCapture(capture)).toBe(s.native);
    expect(s.sdk.createCameraVideoTrack).toHaveBeenCalledWith({
      facingMode: "user",
      encoderConfig: { ...expectedSize, frameRate: 30 },
    });
    expect(s.client.publish).not.toHaveBeenCalled();

    const encoding = { ...requestedSize, frameRate: 30, minimumBitrate: 3000, maximumBitrate: 6000,
      encoderPreference: RtcVideoEncoderPreference.maintainFramerate };
    await s.manager.configureVideoEncoding(encoding);
    expect(s.camera.setEncoderConfiguration).toHaveBeenCalledWith({
      ...expectedSize, frameRate: 30, bitrateMin: 3000, bitrateMax: 6000,
    });
    expect(s.camera.setOptimizationMode).toHaveBeenCalledWith("motion");
    expect(capture).toMatchObject(requestedSize);
    expect(encoding).toMatchObject(requestedSize);
  });

  it("closes late capture instead of retaining a camera after destroy", async () => {
    const s = setup();
    await s.manager.initialize();
    const capture = deferred<typeof s.camera>();
    s.sdk.createCameraVideoTrack.mockReturnValueOnce(capture.promise);
    const pending = s.manager.startCameraCapture({ width: 1920, height: 1024, frameRate: 30, position: CameraPosition.front });
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await s.manager.destroy();
    capture.resolve(s.camera);
    await rejected;
    expect(s.camera.close).toHaveBeenCalledOnce();
  });

  it("uses the exact channel and RTC UID, not the business identity or a numeric channel", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    expect(s.client.join).toHaveBeenCalledWith("app", "000123", "secret", "rtc-user");
    await s.manager.publishLocalAudio();
    await s.manager.unpublishLocalAudio();
    await s.manager.publishLocalAudio();
    expect(s.sdk.createMicrophoneAudioTrack).toHaveBeenCalledOnce();
    await s.manager.updateCredentials({ ...credentials, roomToken: "new-token" });
    expect(s.client.renewToken).toHaveBeenCalledWith("new-token");
    await expect(s.manager.updateCredentials({ ...credentials, roomID: "other" })).rejects.toMatchObject({ code: "SESSION_ERROR" });
  });

  it("stays silent on initial audio subscription and applies volume before play", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    s.manager.setRemoteAudioVolume(0, "bot");
    await s.manager.subscribeRemoteAudio("bot", true);
    expect(s.audio.play).not.toHaveBeenCalled();
    s.manager.setRemoteAudioVolume(32, "bot");
    expect(s.audio.setVolume).toHaveBeenLastCalledWith(32);
    expect(s.audio.setVolume.mock.invocationCallOrder.at(-1)!).toBeLessThan(s.audio.play.mock.invocationCallOrder.at(-1)!);
    s.manager.setRemoteAudioVolume(0, "bot");
    expect(s.audio.stop).toHaveBeenCalled();
  });

  it("handles audio published after video without playing an unsubscribed track", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    s.user.hasAudio = false;
    s.manager.setRemoteAudioVolume(50, "bot");
    await s.manager.subscribeRemoteAudio("bot", true);
    s.user.hasAudio = true;
    s.emit("user-published", s.user, "audio");
    await vi.waitFor(() => expect(s.audio.play).toHaveBeenCalledOnce());
    await s.manager.subscribeRemoteAudio("bot", false);
    s.emit("user-published", s.user, "audio");
    expect(s.audio.play).toHaveBeenCalledOnce();
  });

  it("bridges video, UTF-8 messages and expiry events and ignores events after leave", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    s.emit("user-published", s.user, "video");
    expect(s.listener.onRemoteVideoPublished).toHaveBeenCalledWith("bot", true);
    expect(await s.manager.subscribeRemoteVideo("bot", true)).toBe(s.native);
    s.emit("stream-message", "bot", new TextEncoder().encode('{"text":"中文"}'));
    expect(s.listener.onCustomMessageReceived).toHaveBeenCalledWith("bot", '{"text":"中文"}');
    s.emit("token-privilege-will-expire");
    expect(s.listener.onTokenWillExpire).toHaveBeenCalledOnce();
    expect(s.listener.onTokenExpired).not.toHaveBeenCalled();
    s.emit("token-privilege-did-expire");
    s.emit("token-privilege-did-expire");
    expect(s.listener.onTokenExpired).toHaveBeenCalledOnce();
    await s.manager.leaveRoom();
    s.emit("token-privilege-did-expire");
    s.emit("user-published", s.user, "video");
    expect(s.listener.onTokenExpired).toHaveBeenCalledOnce();
    expect(s.listener.onRemoteVideoPublished).toHaveBeenCalledTimes(2);
  });

  it("renews a token that is only about to expire without rejoining", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    s.emit("token-privilege-will-expire");
    await s.manager.updateCredentials({ ...credentials, roomToken: "new" });
    expect(s.client.renewToken).toHaveBeenCalledWith("new");
    expect(s.client.join).toHaveBeenCalledOnce();
    expect(s.client.leave).not.toHaveBeenCalled();
    expect(s.listener.onRoomRejoining).not.toHaveBeenCalled();
  });

  it("coalesces TOKEN_EXPIRE disconnection and expiry events without dropping subscription intent", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    s.listener.onRemoteVideoPublished.mockClear();
    s.emit("connection-state-change", "DISCONNECTED", "CONNECTED", "TOKEN_EXPIRE");
    s.emit("user-unpublished", s.user, "video");
    s.emit("user-left", s.user);
    s.emit("token-privilege-did-expire");
    expect(s.listener.onTokenExpired).toHaveBeenCalledOnce();
    expect(s.listener.onError).not.toHaveBeenCalled();
    expect(s.listener.onRemoteVideoPublished).not.toHaveBeenCalled();
    await s.manager.updateCredentials({ ...credentials, roomToken: "new" });
    expect(s.client.renewToken).not.toHaveBeenCalled();
    expect(s.listener.onRemoteVideoPublished).toHaveBeenCalledWith("bot", true);
  });

  it("waits for a cancelled late join to finish before opening a new room", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    const joined = deferred<string>();
    s.client.join.mockReturnValueOnce(joined.promise);
    s.emit("token-privilege-did-expire");
    const recovery = s.manager.updateCredentials({ ...credentials, roomToken: "new" });
    const rejected = expect(recovery).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(s.client.join).toHaveBeenCalledTimes(2));
    await s.manager.leaveRoom();
    await rejected;
    const newRoom = s.manager.joinRoom({ ...credentials, roomID: "second-room" });
    await Promise.resolve();
    expect(s.client.join).toHaveBeenCalledTimes(2);
    joined.resolve("rtc-user");
    await newRoom;
    expect(s.client.join).toHaveBeenLastCalledWith("app", "second-room", "secret", "rtc-user");
    const lastLeave = s.client.leave.mock.invocationCallOrder.at(-1)!;
    const lastJoin = s.client.join.mock.invocationCallOrder.at(-1)!;
    expect(lastLeave).toBeLessThan(lastJoin);
    await s.manager.sendRoomMessage("new-room-message");
  });

  it.each([0, 32])("rejoins after expiry and restores publication and audio at %s percent", async (volume) => {
    vi.useFakeTimers();
    const s = setup();
    await s.manager.initialize();
    await s.manager.startCameraCapture({ width: 1920, height: 1024, frameRate: 30, position: CameraPosition.front });
    await s.manager.joinRoom(credentials);
    await s.manager.publishLocalVideo();
    await s.manager.publishLocalAudio();
    s.manager.setRemoteAudioVolume(volume, "bot");
    await s.manager.subscribeRemoteAudio("bot", true);
    s.audio.play.mockClear();
    s.client.publish.mockClear();
    s.client.localTracks = [];
    s.emit("token-privilege-did-expire");
    const next = { ...credentials, roomToken: "new" };
    await Promise.all([s.manager.updateCredentials(next), s.manager.updateCredentials(next)]);

    expect(s.client.renewToken).not.toHaveBeenCalled();
    expect(s.client.leave).toHaveBeenCalledOnce();
    expect(s.client.join).toHaveBeenCalledTimes(2);
    expect(s.client.join).toHaveBeenLastCalledWith("app", "000123", "new", "rtc-user");
    expect(s.client.publish.mock.calls).toEqual([[s.camera], [s.microphone]]);
    expect(s.camera.close).not.toHaveBeenCalled();
    expect(s.sdk.createCameraVideoTrack).toHaveBeenCalledOnce();
    expect(s.sdk.createMicrophoneAudioTrack).toHaveBeenCalledOnce();
    expect(s.listener.onRoomRejoining).toHaveBeenCalledOnce();
    expect(s.audio.setVolume).toHaveBeenLastCalledWith(volume);
    expect(s.audio.play).toHaveBeenCalledTimes(volume === 0 ? 0 : 1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["resolve", "reject"] as const)("upgrades an in-flight renewal to rejoin when it expires before %s", async (outcome) => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    const renewal = deferred<void>();
    s.client.renewToken.mockReturnValueOnce(renewal.promise);
    const updated = s.manager.updateCredentials({ ...credentials, roomToken: "new" });
    s.emit("token-privilege-did-expire");
    if (outcome === "resolve") renewal.resolve();
    else renewal.reject({ code: "TOKEN_EXPIRED" });
    await updated;
    expect(s.client.renewToken).toHaveBeenCalledOnce();
    expect(s.client.join).toHaveBeenCalledTimes(2);
    expect(s.listener.onRoomRejoining).toHaveBeenCalledOnce();
  });

  it("waits for rejoin before sending new room messages and honors mute changes during recovery", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    s.manager.setRemoteAudioVolume(32, "bot");
    await s.manager.subscribeRemoteAudio("bot", true);
    s.audio.play.mockClear();
    s.emit("token-privilege-did-expire");
    const joined = deferred<string>();
    s.client.join.mockReturnValueOnce(joined.promise);
    const updating = s.manager.updateCredentials({ ...credentials, roomToken: "new" });
    const sending = s.manager.sendRoomMessage("heartbeat");
    await vi.waitFor(() => expect(s.client.join).toHaveBeenCalledTimes(2));
    expect(s.client.sendStreamMessage).not.toHaveBeenCalled();
    s.manager.setRemoteAudioVolume(0, "bot");
    joined.resolve("rtc-user");
    await Promise.all([updating, sending]);
    expect(s.client.sendStreamMessage).toHaveBeenCalledWith("heartbeat", false);
    expect(s.audio.setVolume).toHaveBeenLastCalledWith(0);
    expect(s.audio.play).not.toHaveBeenCalled();
  });

  it.each(["leave", "join"] as const)("cancels recovery immediately during %s and never republishes after cancellation", async (phase) => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.startCameraCapture({ width: 1920, height: 1024, frameRate: 30, position: CameraPosition.front });
    await s.manager.joinRoom(credentials);
    await s.manager.publishLocalVideo();
    s.client.publish.mockClear();
    const leaving = deferred<void>();
    const joining = deferred<string>();
    if (phase === "leave") s.client.leave.mockReturnValueOnce(leaving.promise);
    else s.client.join.mockReturnValueOnce(joining.promise);
    s.emit("token-privilege-did-expire");
    const controller = new AbortController();
    const updating = s.manager.updateCredentials({ ...credentials, roomToken: "new" }, controller.signal);
    const rejected = expect(updating).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(phase === "leave" ? s.client.leave : s.client.join).toHaveBeenCalledTimes(phase === "leave" ? 1 : 2));
    const sending = s.manager.sendRoomMessage("stop");
    const sendRejected = expect(sending).rejects.toMatchObject({ code: "CANCELLED" });
    controller.abort();
    await Promise.all([rejected, sendRejected]);
    await s.manager.leaveRoom();
    leaving.resolve();
    joining.resolve("rtc-user");
    await vi.waitFor(() => expect(s.client.leave).toHaveBeenCalledTimes(phase === "leave" ? 2 : 3));
    expect(s.client.publish).not.toHaveBeenCalled();
    expect(s.client.sendStreamMessage).not.toHaveBeenCalled();
  });

  it("propagates failed rejoin without attempting renewToken", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    s.emit("token-privilege-did-expire");
    s.client.join.mockRejectedValueOnce({ code: "INVALID_TOKEN", message: "token=secret" });
    await expect(s.manager.updateCredentials({ ...credentials, roomToken: "new" })).rejects.toThrow("Agora operation failed (INVALID_TOKEN)");
    expect(s.client.renewToken).not.toHaveBeenCalled();
    await s.manager.leaveRoom();
  });

  it("rebinds the generated video after rejoin without restarting its business task", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.startCameraCapture({ width: 1920, height: 1024, frameRate: 30, position: CameraPosition.front });
    const heartbeat = new RoomHeartbeat({ rtcManager: s.manager });
    vi.spyOn(heartbeat, "start").mockImplementation(() => {});
    const bindings = vi.fn();
    const onCredentialsRequired = vi.fn();
    const stream = new StreamController({ rtcManager: s.manager,
      roomController: new RoomController({ rtcManager: s.manager, heartbeat }), remoteStreamListener: bindings, onCredentialsRequired });
    await stream.connect({ ...credentials, botID: "bot" }, false, () => {});
    stream.setRemoteAudioVolume(0);
    await stream.beginGeneration({ taskID: "same-task", videoFormat: new RealtimeVideoFormat({ width: 1920, height: 1024, fps: 30 }),
      context: new RealtimeContext({ prompt: "test" }) });
    await stream.activateRemoteAudio();
    s.emit("token-privilege-will-expire");
    s.emit("token-privilege-did-expire");
    expect(onCredentialsRequired).toHaveBeenCalledTimes(2);
    const newTrack = { kind: "video", id: "new-remote" } as MediaStreamTrack;
    s.client.subscribe.mockImplementation(async (_user, kind) => kind === "audio" ? s.audio : { getMediaStreamTrack: () => newTrack });
    await stream.updateCredentials({ ...credentials, roomToken: "new" });
    await vi.waitFor(() => expect(bindings).toHaveBeenLastCalledWith(expect.objectContaining({ videoTrack: newTrack })));
    expect(bindings).toHaveBeenCalledWith(null);
    expect(stream.hasGenerationTask).toBe(true);
    expect(s.client.sendStreamMessage.mock.calls.filter(([message]) => JSON.parse(message).event === "start")).toHaveLength(1);
    expect(s.audio.play).not.toHaveBeenCalled();
    stream.setRemoteAudioVolume(0.32);
    expect(s.audio.setVolume).toHaveBeenLastCalledWith(32);
    expect(s.audio.play).toHaveBeenCalledOnce();
    await stream.disconnect();
  });

  it("propagates asynchronous send failures, redacts secrets and continues later sends", async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    s.client.sendStreamMessage.mockRejectedValueOnce({ code: "NETWORK_ERROR", message: "token=secret" });
    await expect(s.manager.sendRoomMessage("first")).rejects.toThrow("NETWORK_ERROR");
    await s.manager.sendRoomMessage("second");
    expect(s.client.sendStreamMessage).toHaveBeenLastCalledWith("second", false);
    await expect(s.manager.sendRoomMessage("中".repeat(334))).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
  });

  it("rate limits data stream bytes and cancels queued packets when leaving", async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    for (let i = 0; i < 6; i++) await s.manager.sendRoomMessage("x".repeat(1000));
    const pending = s.manager.sendRoomMessage("next");
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.advanceTimersByTimeAsync(100);
    expect(s.client.sendStreamMessage).toHaveBeenCalledTimes(6);
    await s.manager.leaveRoom();
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.client.sendStreamMessage).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["timeout", "leave"])("bounds an in-flight send on %s and safely consumes late rejection", async (outcome) => {
    vi.useFakeTimers();
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    const sending = deferred<void>();
    s.client.sendStreamMessage.mockReturnValueOnce(sending.promise);
    const pending = s.manager.sendRoomMessage("start");
    const rejected = expect(pending).rejects.toMatchObject({ code: outcome === "timeout" ? "TIMEOUT" : "CANCELLED" });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.client.sendStreamMessage).toHaveBeenCalledOnce();
    if (outcome === "timeout") await vi.advanceTimersByTimeAsync(5000);
    else await s.manager.leaveRoom();
    await rejected;
    sending.reject(new Error("late"));
    await Promise.resolve();
    await s.manager.leaveRoom();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("samples independent of logging, converts bps and ratios, and leaves unsupported metrics absent", async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.manager.initialize();
    await s.manager.joinRoom(credentials);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.listener.onLocalVideoStatistics).toHaveBeenCalledWith(expect.objectContaining({ bitrateKbps: 6000, uplinkLossPercent: 2 }));
    const remote = s.listener.onRemoteVideoStatistics.mock.calls[0]![0][0];
    expect(remote).toMatchObject({ userID: "bot", bitrateKbps: 5000, downlinkLossPercent: 3, rttMs: 12, endToEndDelayMs: 90 });
    expect(remote.jitterBufferDelayMs).toBeUndefined();
    s.emit("network-quality", { uplinkNetworkQuality: 1, downlinkNetworkQuality: 2 });
    expect(s.listener.onNetworkStatistics).toHaveBeenCalledWith({ uplinkQuality: 1, downlinkQuality: 2 });
    await s.manager.leaveRoom();
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.listener.onLocalVideoStatistics).toHaveBeenCalledOnce();
  });
});
