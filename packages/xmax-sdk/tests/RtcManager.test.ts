import { describe, expect, it } from "vitest";
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

describe("RtcManager", () => {
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
