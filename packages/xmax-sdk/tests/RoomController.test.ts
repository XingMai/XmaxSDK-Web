import { describe, expect, it } from "vitest";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import type { RtcEventListener } from "../src/Foundation/RTC/RtcEventListener";
import type { RoomJoinConfiguration } from "../src/Foundation/RTC/RoomJoinConfiguration";
import type { RtcManaging } from "../src/Foundation/RTC/RtcManaging";
import { RealtimeContext } from "../src/Service/Realtime/RealtimeContext";
import { RealtimePoint } from "../src/Service/Realtime/RealtimePoint";
import { RealtimeSessionConnection } from "../src/Service/Realtime/RealtimeSessionConnection";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { RoomController } from "../src/Stream/Room/RoomController";
import { RoomHeartbeat } from "../src/Stream/Room/RoomHeartbeat";

class RtcManagingStub implements RtcManaging {
  isInitialized = true;
  joinRoomCalls: RoomJoinConfiguration[] = [];
  leaveRoomCalls = 0;
  sentMessages: string[] = [];
  eventListener?: RtcEventListener;
  failNextJoin?: XmaxError;

  async initialize(): Promise<void> {}
  async destroy(): Promise<void> {}
  async startCameraCapture(): Promise<MediaStreamTrack> {
    throw new XmaxError(XmaxErrorCode.rtcError, "not supported in stub");
  }
  async switchCameraCapture(): Promise<MediaStreamTrack> {
    throw new XmaxError(XmaxErrorCode.rtcError, "not supported in stub");
  }
  async stopCameraCapture(): Promise<void> {}
  async joinRoom(configuration: RoomJoinConfiguration): Promise<void> {
    if (this.failNextJoin) {
      const error = this.failNextJoin;
      this.failNextJoin = undefined;
      throw error;
    }
    this.joinRoomCalls.push(configuration);
  }
  async leaveRoom(): Promise<void> {
    this.leaveRoomCalls += 1;
  }
  async publishLocalVideo(): Promise<void> {}
  async unpublishLocalVideo(): Promise<void> {}
  async publishLocalAudio(): Promise<void> {}
  async unpublishLocalAudio(): Promise<void> {}
  async subscribeRemoteVideo(): Promise<MediaStreamTrack | undefined> {
    return undefined;
  }
  async subscribeRemoteAudio(): Promise<void> {}
  setRemoteAudioVolume(): void {}
  sendRoomMessage(message: string): void {
    this.sentMessages.push(message);
  }
  setEventListener(listener?: RtcEventListener): void {
    this.eventListener = listener;
  }
}

class RoomHeartbeatStub extends RoomHeartbeat {
  startedUserIDs: string[] = [];
  stopCalls = 0;

  override start(userID: string): void {
    this.startedUserIDs.push(userID);
  }

  override stop(): void {
    this.stopCalls += 1;
  }
}

const connection = new RealtimeSessionConnection({
  provider: "trtc",
  roomID: "100000001",
  sdkAppID: "1600126360",
  userID: "rtc-user-001",
  userSig: "sig-v1",
  privateMapKey: "pmk-v1",
  botID: "bot001",
});

const videoFormat = new RealtimeVideoFormat({ width: 832, height: 1472, fps: 30 });
const context = new RealtimeContext({ prompt: "a cat", referencePath: "ref/1.png" });

function makeController() {
  const rtc = new RtcManagingStub();
  const heartbeat = new RoomHeartbeatStub({ rtcManager: rtc });
  const controller = new RoomController({ rtcManager: rtc, heartbeat });
  return { controller, rtc, heartbeat };
}

const noopEnsureActive = () => {};

describe("RoomController", () => {
  it("joins with mapped configuration and starts heartbeat", async () => {
    const { controller, rtc, heartbeat } = makeController();
    await controller.join(connection, noopEnsureActive);

    expect(rtc.joinRoomCalls).toHaveLength(1);
    expect(rtc.joinRoomCalls[0]).toMatchObject({
      roomID: "100000001",
      userID: "rtc-user-001",
      sdkAppID: "1600126360",
      userSig: "sig-v1",
      privateMapKey: "pmk-v1",
    });
    expect(heartbeat.startedUserIDs).toEqual(["rtc-user-001"]);
  });

  it("rejects joining while already in a room", async () => {
    const { controller } = makeController();
    await controller.join(connection, noopEnsureActive);
    await expect(controller.join(connection, noopEnsureActive)).rejects.toMatchObject({
      code: XmaxErrorCode.invalidConfiguration,
    });
  });

  it("cleans up the room when join fails", async () => {
    const { controller, rtc, heartbeat } = makeController();
    rtc.failNextJoin = new XmaxError(XmaxErrorCode.rtcError, "join rejected");

    await expect(controller.join(connection, noopEnsureActive)).rejects.toMatchObject({
      code: XmaxErrorCode.rtcError,
    });
    expect(rtc.leaveRoomCalls).toBe(1);
    expect(heartbeat.startedUserIDs).toHaveLength(0);

    // 清理完成后可以重新进房。
    await controller.join(connection, noopEnsureActive);
    expect(rtc.joinRoomCalls).toHaveLength(1);
  });

  it("leaves the room when the operation becomes inactive right after joining", async () => {
    const { controller, rtc } = makeController();
    let calls = 0;
    const ensureActive = () => {
      calls += 1;
      if (calls > 1) {
        throw new XmaxError(XmaxErrorCode.cancelled, "obsolete");
      }
    };

    await expect(controller.join(connection, ensureActive)).rejects.toMatchObject({
      code: XmaxErrorCode.cancelled,
    });
    expect(rtc.leaveRoomCalls).toBe(1);
  });

  it("sends start generation signaling with full generation parameters", async () => {
    const { controller, rtc } = makeController();
    await controller.join(connection, noopEnsureActive);

    controller.startGeneration({
      taskID: "task-001",
      videoFormat,
      targetSize: { width: 416, height: 736 },
      context,
    });

    expect(rtc.sentMessages).toHaveLength(1);
    const message = JSON.parse(rtc.sentMessages[0]!);
    expect(message.event).toBe("start");
    expect(message.user_id).toBe("rtc-user-001");
    expect(message.uid).toBe("task-001");
    expect(message.params).toMatchObject({
      model: "default",
      size: [832, 1472],
      target_size: [416, 736],
      prompt: "a cat",
      ref_image_path: "ref/1.png",
    });
    expect(message.runtime?.platform).toBe("web");
  });

  it("sends condition change, target size, stop and tracks signaling", async () => {
    const { controller, rtc } = makeController();
    await controller.join(connection, noopEnsureActive);

    controller.changeGenerationCondition({ taskID: "task-001", videoFormat, context });
    let ensureActiveCalled = false;
    controller.changeTargetSize({
      taskID: "task-001",
      targetSize: { width: 640, height: 960 },
      ensureActive: () => {
        ensureActiveCalled = true;
      },
    });
    controller.stopGeneration("task-001");
    controller.sendTracks("task-001", [
      new RealtimePoint({ x: 0.5, y: 0.25 }),
    ]);

    expect(ensureActiveCalled).toBe(true);
    const events = rtc.sentMessages.map((raw) => JSON.parse(raw));
    expect(events.map((m) => m.event)).toEqual([
      "change_condition",
      "change_target_size",
      "stop",
      "tracks",
    ]);
    expect(events[1].params.target_size).toEqual([640, 960]);
    expect(events[3].tracks).toEqual([[0.5, 0.25]]);
  });

  it("ignores stop when the room is not joined but rejects tracks", () => {
    const { controller, rtc } = makeController();
    controller.stopGeneration("task-001");
    controller.sendTracks("task-001", []);
    expect(rtc.sentMessages).toHaveLength(0);

    expect(() =>
      controller.sendTracks("task-001", [new RealtimePoint({ x: 0, y: 0 })]),
    ).toThrowError(expect.objectContaining({ code: XmaxErrorCode.rtcError }));
  });

  it("throws rtcError when signaling before joining", () => {
    const { controller } = makeController();
    expect(() =>
      controller.startGeneration({ taskID: "task-001", videoFormat, context }),
    ).toThrowError(expect.objectContaining({ code: XmaxErrorCode.rtcError }));
  });

  it("leaves the room, stops heartbeat and allows rejoining", async () => {
    const { controller, rtc, heartbeat } = makeController();
    await controller.join(connection, noopEnsureActive);
    await controller.leave();

    expect(rtc.leaveRoomCalls).toBe(1);
    expect(heartbeat.stopCalls).toBeGreaterThan(0);

    await controller.leave();
    expect(rtc.leaveRoomCalls).toBe(1);

    await controller.join(connection, noopEnsureActive);
    expect(rtc.joinRoomCalls).toHaveLength(2);
  });

  it("dispatches inbound business messages after user_id filtering", async () => {
    const { controller } = makeController();
    const received: Array<[string, Record<string, unknown>]> = [];
    controller.setListener({
      onRoomMessage: (sender, message) => received.push([sender, message]),
    });
    await controller.join(connection, noopEnsureActive);

    const emit = (sender: string, payload: unknown) =>
      controller.handleIncomingMessage(sender, JSON.stringify(payload));

    emit("bot001", { event: "tracks", user_id: "rtc-user-001", values: [] });
    emit("bot001", { event: "tracks", user_id: "someone-else", values: [] });
    emit("bot001", { event: "tracks", values: [] });

    expect(received).toHaveLength(2);
    expect(received[0]?.[0]).toBe("bot001");
    expect(received[0]?.[1].event).toBe("tracks");
  });

  it("reassembles chunked inbound messages before dispatching", async () => {
    const { controller } = makeController();
    const received: Record<string, unknown>[] = [];
    controller.setListener({
      onRoomMessage: (_sender, message) => received.push(message),
    });
    await controller.join(connection, noopEnsureActive);

    const business = JSON.stringify({
      event: "tracks",
      user_id: "rtc-user-001",
      note: "长文本".repeat(100),
    });
    // 手工构造二分片并乱序投递。
    const half = Math.ceil(business.length / 2);
    const chunks = [
      { event: "__trtc_chunk__", eventId: "evt-9", index: 0, count: 2, data: business.slice(0, half) },
      { event: "__trtc_chunk__", eventId: "evt-9", index: 1, count: 2, data: business.slice(half) },
    ];
    controller.handleIncomingMessage("bot001", JSON.stringify(chunks[1]));
    expect(received).toHaveLength(0);
    controller.handleIncomingMessage("bot001", JSON.stringify(chunks[0]));

    expect(received).toHaveLength(1);
    expect(received[0]?.note).toBe("长文本".repeat(100));
  });
});
