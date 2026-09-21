import { afterEach, describe, expect, it, vi } from "vitest";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { CameraPosition } from "../src/Foundation/Media/Camera/CameraPosition";
import { RemoteStream } from "../src/Foundation/RTC/RemoteStream";
import { RoomJoinConfiguration } from "../src/Foundation/RTC/RoomJoinConfiguration";
import type { RtcEventListener } from "../src/Foundation/RTC/RtcEventListener";
import { RtcEngineManager, type RtcEngine } from "../src/Foundation/RTC/RtcEngineManager";
import { RtcManager } from "../src/Foundation/RTC/RtcManager";

class FakeRtcEngine {
  destroyed = false;

  // 采集
  startLocalVideoCalls: unknown[] = [];
  updateLocalVideoCalls: unknown[] = [];
  stopLocalVideoCalls = 0;
  localVideoTrack = { id: "local-track" } as unknown as MediaStreamTrack;

  // 音频
  startLocalAudioCalls = 0;
  updateLocalAudioCalls: unknown[] = [];
  stopLocalAudioCalls = 0;

  // 房间
  enterRoomCalls: unknown[] = [];
  exitRoomCalls = 0;

  // 远端
  startRemoteVideoCalls: unknown[] = [];
  stopRemoteVideoCalls: unknown[] = [];
  remoteVideoTrack = { id: "remote-track" } as unknown as MediaStreamTrack;
  muteRemoteAudioCalls: Array<[string, boolean]> = [];
  volumeCalls: Array<[string, number]> = [];

  // 消息
  sentMessages: Array<{ cmdId: number; data: ArrayBuffer }> = [];

  // 事件
  private handlers = new Map<string, Array<(event: unknown) => void>>();

  on(event: string, handler: (event: unknown) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  off(event: string, handler: (event: unknown) => void): void {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((item) => item !== handler));
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }

  destroy(): void {
    this.destroyed = true;
  }

  async startLocalVideo(config: unknown): Promise<void> {
    this.startLocalVideoCalls.push(config);
  }

  async updateLocalVideo(config: unknown): Promise<void> {
    this.updateLocalVideoCalls.push(config);
  }

  async stopLocalVideo(): Promise<void> {
    this.stopLocalVideoCalls += 1;
  }

  getVideoTrack(config?: { userId?: string }): MediaStreamTrack | null {
    return config?.userId ? this.remoteVideoTrack : this.localVideoTrack;
  }

  async startLocalAudio(): Promise<void> {
    this.startLocalAudioCalls += 1;
  }

  async updateLocalAudio(config: unknown): Promise<void> {
    this.updateLocalAudioCalls.push(config);
  }

  async stopLocalAudio(): Promise<void> {
    this.stopLocalAudioCalls += 1;
  }

  async enterRoom(config: unknown): Promise<void> {
    this.enterRoomCalls.push(config);
  }

  async exitRoom(): Promise<void> {
    this.exitRoomCalls += 1;
  }

  async startRemoteVideo(config: unknown): Promise<void> {
    this.startRemoteVideoCalls.push(config);
  }

  async stopRemoteVideo(config: unknown): Promise<void> {
    this.stopRemoteVideoCalls.push(config);
  }

  async muteRemoteAudio(userId: string, mute: boolean): Promise<void> {
    this.muteRemoteAudioCalls.push([userId, mute]);
  }

  setRemoteAudioVolume(userId: string, volume: number): void {
    this.volumeCalls.push([userId, volume]);
  }

  sendCustomMessage(message: { cmdId: number; data: ArrayBuffer }): void {
    this.sentMessages.push(message);
  }
}

function makeManager() {
  const engine = new FakeRtcEngine();
  const engineManager = new RtcEngineManager(async () => engine as unknown as RtcEngine);
  const manager = new RtcManager(engineManager);
  return { manager, engine };
}

const joinConfig = new RoomJoinConfiguration({
  roomID: "100000001",
  userID: "rtc-user-001",
  sdkAppID: "1600126360",
  userSig: "sig-v1",
  privateMapKey: "pmk-v1",
});

describe("RtcManager performance logging", () => {
  afterEach(() => {
    XmaxLogger.configure(XmaxLoggerOption.none);
    vi.restoreAllMocks();
  });

  const emitMetrics = (engine: FakeRtcEngine) => {
    engine.emit("statistics", {
      rtt: 32, upLoss: 1.5, downLoss: 0,
      bytesSent: 1000, bytesReceived: 2000,
      localStatistics: { video: [] }, remoteStatistics: [],
    });
    engine.emit("network-quality", {
      uplinkNetworkQuality: 1, downlinkNetworkQuality: 2,
      uplinkRTT: 32, downlinkRTT: 48, uplinkLoss: 1.5, downlinkLoss: 0,
    });
  };

  it("only logs while joined, follows dynamic options, and resumes on rejoin", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    XmaxLogger.configure(XmaxLoggerOption.performance);
    const { manager, engine } = makeManager();
    await manager.initialize();
    await manager.initialize();
    emitMetrics(engine);
    expect(info).not.toHaveBeenCalled();

    await manager.joinRoom(joinConfig);
    emitMetrics(engine);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[0]![0]).toContain("RTC Statistics");
    expect(info.mock.calls[1]![0]).toContain("Network Quality Metrics");
    XmaxLogger.configure(XmaxLoggerOption.business);
    emitMetrics(engine);
    expect(info).toHaveBeenCalledTimes(2);
    XmaxLogger.configure(XmaxLoggerOption.all);
    emitMetrics(engine);
    expect(info).toHaveBeenCalledTimes(4);

    await manager.leaveRoom();
    emitMetrics(engine);
    expect(info).toHaveBeenCalledTimes(4);
    await manager.joinRoom(joinConfig);
    emitMetrics(engine);
    expect(info).toHaveBeenCalledTimes(6);
    await manager.destroy();
  });

  it("removes statistics subscriptions on destroy without duplicates after reinitialization", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    XmaxLogger.configure(XmaxLoggerOption.performance);
    const { manager, engine } = makeManager();
    const off = vi.spyOn(engine, "off");
    await manager.initialize();
    await manager.joinRoom(joinConfig);
    await manager.destroy();
    expect(off).toHaveBeenCalledWith("statistics", expect.any(Function));
    expect(off).toHaveBeenCalledWith("network-quality", expect.any(Function));
    emitMetrics(engine);
    expect(info).not.toHaveBeenCalled();

    await manager.initialize();
    await manager.joinRoom(joinConfig);
    emitMetrics(engine);
    expect(info).toHaveBeenCalledTimes(2);
    await manager.destroy();
  });
});

describe("RtcManager", () => {
  it("maps directional network quality and RTT without requiring logs or remote video", async () => {
    const { manager, engine } = makeManager();
    const listener = vi.fn();
    XmaxLogger.configure(XmaxLoggerOption.none);
    manager.setEventListener({
      onRemoteVideoPublished: () => {}, onCustomMessageReceived: () => {},
      onNetworkStatistics: listener,
    });
    await manager.initialize();
    const stats = { uplinkNetworkQuality: 1, downlinkNetworkQuality: 4, uplinkRTT: 21, downlinkRTT: 85 };
    engine.emit("network-quality", stats);
    expect(listener).not.toHaveBeenCalled();
    await manager.joinRoom(joinConfig);
    engine.emit("network-quality", stats);
    expect(listener).toHaveBeenLastCalledWith({ uplinkQuality: 1, downlinkQuality: 4, uplinkRttMs: 21, downlinkRttMs: 85 });
    expect(Object.isFrozen(listener.mock.calls[0]![0])).toBe(true);
    for (const level of [0, 1, 2, 3, 4, 5, 6]) {
      engine.emit("network-quality", { ...stats, uplinkNetworkQuality: level, downlinkNetworkQuality: level });
      expect(listener.mock.calls.at(-1)![0]).toMatchObject({ uplinkQuality: level, downlinkQuality: level });
    }
    listener.mockClear();
    await manager.leaveRoom();
    engine.emit("network-quality", stats);
    expect(listener).not.toHaveBeenCalled();
    await manager.joinRoom(joinConfig);
    engine.emit("network-quality", stats);
    expect(listener).toHaveBeenCalledOnce();
    await manager.destroy();
    listener.mockClear();
    engine.emit("network-quality", stats);
    expect(listener).not.toHaveBeenCalled();
  });

  it("normalizes missing or invalid network metrics while retaining zero RTT", async () => {
    const { manager, engine } = makeManager();
    const listener = vi.fn();
    manager.setEventListener({
      onRemoteVideoPublished: () => {}, onCustomMessageReceived: () => {},
      onNetworkStatistics: listener,
    });
    await manager.initialize();
    await manager.joinRoom(joinConfig);
    for (const invalid of [undefined, -1, 7, 1.5, NaN, Infinity]) {
      engine.emit("network-quality", {
        uplinkNetworkQuality: invalid, downlinkNetworkQuality: invalid,
        uplinkRTT: NaN, downlinkRTT: -1,
      });
      expect(listener).toHaveBeenLastCalledWith({
        uplinkQuality: undefined, downlinkQuality: undefined,
        uplinkRttMs: undefined, downlinkRttMs: undefined,
      });
    }
    engine.emit("network-quality", { uplinkRTT: 0, downlinkRTT: Infinity });
    expect(listener.mock.calls.at(-1)![0]).toMatchObject({ uplinkRttMs: 0, downlinkRttMs: undefined });
    await manager.destroy();
  });

  it("maps remote main-video statistics with cloud RTT and optional video E2E", async () => {
    const { manager, engine } = makeManager();
    const listener = vi.fn();
    manager.setEventListener({
      onRemoteVideoPublished: () => {}, onCustomMessageReceived: () => {},
      onRemoteVideoStatistics: listener,
    });
    await manager.initialize();
    await manager.joinRoom(joinConfig);
    engine.emit("statistics", {
      rtt: 20,
      upLoss: 1.5, downLoss: 0,
      localStatistics: { video: [{ videoType: "big", width: 640, height: 480, frameRate: 30, bitrate: 500 }] },
      remoteStatistics: [
        { userId: "audio-only", audio: { point2pointDelay: 999 }, video: [] },
        { userId: "bot-1", audio: { point2pointDelay: 143 }, video: [
          { videoType: "small", width: 320, height: 180 },
          { videoType: "big", width: 1920, height: 1024, frameRate: 26, bitrate: 6399.74, jitterBufferDelay: 42, point2pointDelay: 87 },
          { videoType: "sub", width: 1280, height: 720 },
        ] },
      ],
    });
    expect(listener).toHaveBeenLastCalledWith([{
      userID: "bot-1", width: 1920, height: 1024, frameRate: 26,
      bitrateKbps: 6399.74, rttMs: 20, endToEndDelayMs: 87,
      uplinkLossPercent: 1.5, downlinkLossPercent: 0, jitterBufferDelayMs: 42,
    }]);
    expect(Object.isFrozen(listener.mock.calls[0]![0])).toBe(true);
    expect(Object.isFrozen(listener.mock.calls[0]![0][0])).toBe(true);

    engine.emit("statistics", {
      rtt: -1,
      remoteStatistics: [{ userId: "bot-1", video: [
        { videoType: "big", width: 1920, height: 1024, frameRate: 0, bitrate: 0, jitterBufferDelay: 87 },
      ] }],
    });
    expect(listener).toHaveBeenLastCalledWith([{
      userID: "bot-1", width: 1920, height: 1024, frameRate: 0,
      bitrateKbps: 0, rttMs: undefined, endToEndDelayMs: undefined,
      uplinkLossPercent: undefined, downlinkLossPercent: undefined, jitterBufferDelayMs: 87,
    }]);
    engine.emit("statistics", { rtt: 10, remoteStatistics: [] });
    expect(listener).toHaveBeenLastCalledWith([]);
    await manager.leaveRoom();
    engine.emit("statistics", { remoteStatistics: [] });
    expect(listener).toHaveBeenCalledTimes(3);
    await manager.destroy();
  });

  it.each([
    [0, 0, 0, 0, 0, 0],
    [100, 2.5, 254, 100, 2.5, 254],
    [-1, 101, -1, undefined, undefined, undefined],
    [NaN, Infinity, NaN, undefined, undefined, undefined],
    [undefined, undefined, undefined, undefined, undefined, undefined],
  ])("normalizes loss and buffer statistics (%s, %s, %s)", async (upLoss, downLoss, buffer, up, down, delay) => {
    const { manager, engine } = makeManager();
    const listener = vi.fn();
    manager.setEventListener({
      onRemoteVideoPublished: () => {}, onCustomMessageReceived: () => {},
      onRemoteVideoStatistics: listener,
    });
    await manager.initialize();
    await manager.joinRoom(joinConfig);
    engine.emit("statistics", {
      upLoss, downLoss,
      remoteStatistics: [{ userId: "bot", video: [{ videoType: "big", jitterBufferDelay: buffer }] }],
    });
    expect(listener).toHaveBeenLastCalledWith([expect.objectContaining({
      uplinkLossPercent: up, downlinkLossPercent: down, jitterBufferDelayMs: delay,
      endToEndDelayMs: undefined,
    })]);
    await manager.destroy();
  });

  it("forwards actual local main-video metrics independently of the log option", async () => {
    XmaxLogger.configure(XmaxLoggerOption.none);
    const { manager, engine } = makeManager();
    const listener = vi.fn();
    manager.setEventListener({
      onRemoteVideoPublished: () => {},
      onCustomMessageReceived: () => {},
      onLocalVideoStatistics: listener,
    });
    await manager.initialize();
    const stats = {
      localStatistics: { video: [
        { videoType: "small", width: 320, height: 180, frameRate: 10, bitrate: 200 },
        { videoType: "big", width: 1920, height: 1024, frameRate: 29, bitrate: 6006.51 },
        { videoType: "sub", width: 1280, height: 720, frameRate: 15, bitrate: 500 },
      ] },
      remoteStatistics: [{ video: [{ videoType: "big", width: 640, height: 480, frameRate: 26, bitrate: 800 }] }],
    };
    engine.emit("statistics", stats);
    expect(listener).not.toHaveBeenCalled();
    await manager.joinRoom(joinConfig);
    engine.emit("statistics", stats);
    expect(listener).toHaveBeenLastCalledWith({ width: 1920, height: 1024, frameRate: 29, bitrateKbps: 6006.51 });
    expect(Object.isFrozen(listener.mock.calls[0]![0])).toBe(true);

    engine.emit("statistics", { localStatistics: { video: [{ videoType: "small" }] } });
    expect(listener).toHaveBeenLastCalledWith(undefined);
    await manager.leaveRoom();
    engine.emit("statistics", stats);
    expect(listener).toHaveBeenCalledTimes(2);
    await manager.destroy();
  });

  it("normalizes invalid video metrics while retaining zero fps and bitrate", async () => {
    const { manager, engine } = makeManager();
    const listener = vi.fn();
    manager.setEventListener({
      onRemoteVideoPublished: () => {}, onCustomMessageReceived: () => {},
      onLocalVideoStatistics: listener,
    });
    await manager.initialize();
    await manager.joinRoom(joinConfig);
    engine.emit("statistics", { localStatistics: { video: [
      { videoType: "big", width: 0, height: Infinity, frameRate: NaN, bitrate: -1 },
    ] } });
    expect(listener).toHaveBeenLastCalledWith({ width: undefined, height: undefined, frameRate: undefined, bitrateKbps: undefined });
    engine.emit("statistics", { localStatistics: { video: [
      { videoType: "big", width: 1920, height: 1024, frameRate: 0, bitrate: 0 },
    ] } });
    expect(listener).toHaveBeenLastCalledWith({ width: 1920, height: 1024, frameRate: 0, bitrateKbps: 0 });
    await manager.destroy();
  });

  it("initializes once and destroys the engine with the lease", async () => {
    const { manager, engine } = makeManager();
    expect(manager.isInitialized).toBe(false);

    await manager.initialize();
    await manager.initialize();
    expect(manager.isInitialized).toBe(true);

    await manager.destroy();
    expect(manager.isInitialized).toBe(false);
    expect(engine.destroyed).toBe(true);
  });

  it("joins the room with mapped TRTC parameters", async () => {
    const { manager, engine } = makeManager();
    await manager.initialize();
    await manager.joinRoom(joinConfig);

    expect(engine.enterRoomCalls).toEqual([
      {
        sdkAppId: 1600126360,
        userId: "rtc-user-001",
        userSig: "sig-v1",
        strRoomId: "100000001",
        privateMapKey: "pmk-v1",
      },
    ]);
  });

  it("rejects joinRoom with a non-numeric sdkAppID", async () => {
    const { manager } = makeManager();
    await manager.initialize();
    await expect(
      manager.joinRoom(
        new RoomJoinConfiguration({ ...joinConfig, sdkAppID: "abc" }),
      ),
    ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
  });

  it("rejects operations before initialize", async () => {
    const { manager } = makeManager();
    await expect(manager.joinRoom(joinConfig)).rejects.toMatchObject({
      code: XmaxErrorCode.rtcError,
    });
  });

  it("publishes and unpublishes local video while capture keeps running", async () => {
    const { manager, engine } = makeManager();
    await manager.initialize();

    await expect(manager.publishLocalVideo()).rejects.toMatchObject({
      code: XmaxErrorCode.invalidConfiguration,
    });

    await manager.startCameraCapture({
      width: 832,
      height: 1472,
      frameRate: 30,
      position: CameraPosition.front,
    });
    expect(engine.startLocalVideoCalls[0]).toMatchObject({ publish: false });

    await manager.publishLocalVideo();
    await manager.unpublishLocalVideo();
    expect(engine.updateLocalVideoCalls).toEqual([
      { publish: true },
      { publish: false },
    ]);
    // 取消发布不停止采集。
    expect(engine.stopLocalVideoCalls).toBe(0);
  });

  it("starts microphone capture on first audio publish and unpublishes afterwards", async () => {
    const { manager, engine } = makeManager();
    await manager.initialize();

    await manager.publishLocalAudio();
    expect(engine.startLocalAudioCalls).toBe(1);

    await manager.publishLocalAudio();
    expect(engine.updateLocalAudioCalls).toEqual([{ publish: true }]);

    await manager.unpublishLocalAudio();
    expect(engine.updateLocalAudioCalls).toEqual([
      { publish: true },
      { publish: false },
    ]);
  });

  it("subscribes remote video and returns the remote track", async () => {
    const { manager, engine } = makeManager();
    await manager.initialize();

    const track = await manager.subscribeRemoteVideo("bot001", true);
    expect(engine.startRemoteVideoCalls).toEqual([
      { userId: "bot001", streamType: "main" },
    ]);
    expect(track).toBe(engine.remoteVideoTrack);

    const cleared = await manager.subscribeRemoteVideo("bot001", false);
    expect(engine.stopRemoteVideoCalls).toEqual([
      { userId: "bot001", streamType: "main" },
    ]);
    expect(cleared).toBeUndefined();
  });

  it("maps remote audio subscription to mute control", async () => {
    const { manager, engine } = makeManager();
    await manager.initialize();

    await manager.subscribeRemoteAudio("bot001", true);
    await manager.subscribeRemoteAudio("bot001", false);
    expect(engine.muteRemoteAudioCalls).toEqual([
      ["bot001", false],
      ["bot001", true],
    ]);
  });

  it("forwards remote audio volume within 0...100", async () => {
    const { manager, engine } = makeManager();
    await manager.initialize();

    manager.setRemoteAudioVolume(80, "bot001");
    manager.setRemoteAudioVolume(150, "bot001");
    expect(engine.volumeCalls).toEqual([
      ["bot001", 80],
      ["bot001", 100],
    ]);
  });

  it("sends room messages as cmdId 1 custom messages", async () => {
    const { manager, engine } = makeManager();
    await manager.initialize();

    expect(() => manager.sendRoomMessage("{}")).toThrowError(
      expect.objectContaining({ code: XmaxErrorCode.invalidConfiguration }),
    );

    await manager.joinRoom(joinConfig);
    manager.sendRoomMessage(JSON.stringify({ event: "heartbeat" }));
    expect(engine.sentMessages).toHaveLength(1);
    expect(engine.sentMessages[0]?.cmdId).toBe(1);
    expect(new TextDecoder().decode(engine.sentMessages[0]!.data)).toBe(
      '{"event":"heartbeat"}',
    );
  });

  it("rejects room messages over the 1000-byte limit", async () => {
    const { manager } = makeManager();
    await manager.initialize();
    await manager.joinRoom(joinConfig);

    expect(() => manager.sendRoomMessage("x".repeat(1001))).toThrowError(
      expect.objectContaining({ code: XmaxErrorCode.invalidConfiguration }),
    );
  });

  it("bridges remote video and custom message events to the listener", async () => {
    const { manager, engine } = makeManager();
    const events: Array<[string, unknown]> = [];
    const listener: RtcEventListener = {
      onRemoteVideoPublished: (userID, published) =>
        events.push(["video", [userID, published]]),
      onCustomMessageReceived: (userID, message) =>
        events.push(["message", [userID, message]]),
    };
    manager.setEventListener(listener);
    await manager.initialize();

    engine.emit("remote-video-available", { userId: "bot001", streamType: "main" });
    engine.emit("remote-video-available", { userId: "bot001", streamType: "sub" });
    engine.emit("remote-video-unavailable", { userId: "bot001", streamType: "main" });
    engine.emit("custom-message", {
      userId: "bot001",
      cmdId: 1,
      data: new TextEncoder().encode('{"event":"tracks"}').buffer,
    });
    engine.emit("custom-message", {
      userId: "bot001",
      cmdId: 2,
      data: new TextEncoder().encode("ignored").buffer,
    });

    expect(events).toEqual([
      ["video", ["bot001", true]],
      ["video", ["bot001", false]],
      ["message", ["bot001", '{"event":"tracks"}']],
    ]);
  });

  it("leaves the room on leaveRoom and keeps capture preview alive", async () => {
    const { manager, engine } = makeManager();
    await manager.initialize();
    await manager.startCameraCapture({
      width: 832,
      height: 1472,
      frameRate: 30,
      position: CameraPosition.front,
    });
    await manager.joinRoom(joinConfig);

    await manager.leaveRoom();
    expect(engine.exitRoomCalls).toBe(1);
    expect(engine.stopLocalVideoCalls).toBe(0);

    await manager.leaveRoom();
    expect(engine.exitRoomCalls).toBe(1);
  });

  it("generates cross-room unique keys for remote streams", () => {
    const stream = new RemoteStream({ roomID: "r1", userID: "bot001" });
    expect(stream.key).toBe("r1:bot001");
  });
});
