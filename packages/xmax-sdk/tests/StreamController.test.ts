import { describe, expect, it, vi } from "vitest";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import type { RtcEventListener } from "../src/Foundation/RTC/RtcEventListener";
import type { RoomJoinConfiguration } from "../src/Foundation/RTC/RoomJoinConfiguration";
import type { RtcManaging } from "../src/Foundation/RTC/RtcManaging";
import { RealtimeContext } from "../src/Service/Realtime/RealtimeContext";
import { RealtimeSessionConnection } from "../src/Service/Realtime/RealtimeSessionConnection";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { RoomController } from "../src/Stream/Room/RoomController";
import { RoomHeartbeat } from "../src/Stream/Room/RoomHeartbeat";
import { StreamController } from "../src/Stream/StreamController";
import type { RemoteStreamBinding } from "../src/Stream/StreamControlling";
import type { VideoEncodingConfiguration } from "../src/Foundation/RTC/VideoEncodingConfiguration";

class RtcManagingStub implements RtcManaging {
  isInitialized = true;

  // 房间
  joinRoomCalls: RoomJoinConfiguration[] = [];
  leaveRoomCalls = 0;
  failNextJoin?: XmaxError;

  // 发布
  publishLocalVideoCalls = 0;
  unpublishLocalVideoCalls = 0;
  publishLocalAudioCalls = 0;
  unpublishLocalAudioCalls = 0;
  failNextPublishAudio = false;

  // 远端订阅
  subscribeRemoteVideoCalls: Array<[string, boolean]> = [];
  subscribeRemoteAudioCalls: Array<[string, boolean]> = [];
  remoteVideoTrack = { id: "remote-track" } as unknown as MediaStreamTrack;

  // 音量
  volumeCalls: Array<[number, string]> = [];

  // 消息与事件
  sentMessages: string[] = [];
  failNextSend = false;
  eventListener?: RtcEventListener;

  async initialize(): Promise<void> {}
  async destroy(): Promise<void> {}
  async startCameraCapture(): Promise<MediaStreamTrack> {
    throw new XmaxError(XmaxErrorCode.rtcError, "not supported in stub");
  }
  async switchCameraCapture(): Promise<MediaStreamTrack> {
    throw new XmaxError(XmaxErrorCode.rtcError, "not supported in stub");
  }
  async stopCameraCapture(): Promise<void> {}

  encodingConfigurations: VideoEncodingConfiguration[] = [];

  async configureVideoEncoding(
    configuration: VideoEncodingConfiguration,
  ): Promise<void> {
    this.encodingConfigurations.push(configuration);
  }
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
  async publishLocalVideo(): Promise<void> {
    this.publishLocalVideoCalls += 1;
  }
  async unpublishLocalVideo(): Promise<void> {
    this.unpublishLocalVideoCalls += 1;
  }
  async publishLocalAudio(): Promise<void> {
    if (this.failNextPublishAudio) {
      this.failNextPublishAudio = false;
      throw new XmaxError(XmaxErrorCode.mediaError, "microphone busy");
    }
    this.publishLocalAudioCalls += 1;
  }
  async unpublishLocalAudio(): Promise<void> {
    this.unpublishLocalAudioCalls += 1;
  }
  async subscribeRemoteVideo(
    userID: string,
    subscribe: boolean,
  ): Promise<MediaStreamTrack | undefined> {
    this.subscribeRemoteVideoCalls.push([userID, subscribe]);
    return subscribe ? this.remoteVideoTrack : undefined;
  }
  async subscribeRemoteAudio(userID: string, subscribe: boolean): Promise<void> {
    this.subscribeRemoteAudioCalls.push([userID, subscribe]);
  }
  setRemoteAudioVolume(volume: number, userID: string): void {
    this.volumeCalls.push([volume, userID]);
  }
  sendRoomMessage(message: string): void {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new XmaxError(XmaxErrorCode.rtcError, "send failed");
    }
    this.sentMessages.push(message);
  }
  setEventListener(listener?: RtcEventListener): void {
    this.eventListener = listener;
  }
}

class RoomHeartbeatStub extends RoomHeartbeat {
  override start(): void {}
  override stop(): void {}
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
const context = new RealtimeContext({ prompt: "a cat" });
const noopEnsureActive = () => {};

function makeStream(options?: { generationTimeoutMs?: number }) {
  const rtc = new RtcManagingStub();
  const roomController = new RoomController({
    rtcManager: rtc,
    heartbeat: new RoomHeartbeatStub({ rtcManager: rtc }),
  });
  const bindings: Array<RemoteStreamBinding | null> = [];
  const errors: XmaxError[] = [];
  const controller = new StreamController({
    rtcManager: rtc,
    roomController,
    errorListener: (error) => errors.push(error),
    remoteStreamListener: (binding) => bindings.push(binding),
    generationTimeoutMs: options?.generationTimeoutMs,
  });
  return { controller, rtc, bindings, errors };
}

function emitRemoteVideo(
  rtc: RtcManagingStub,
  userID: string,
  published: boolean,
): void {
  rtc.eventListener?.onRemoteVideoPublished(userID, published);
}

describe("StreamController", () => {
  it("先进入房间，曝光屏障通过后才发布视频和音频", async () => {
    const { controller, rtc } = makeStream();
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { ready = resolve; });
    const beforePublish = vi.fn(() => gate);
    const pending = controller.connect(connection, true, noopEnsureActive, beforePublish);
    await vi.waitFor(() => expect(beforePublish).toHaveBeenCalledOnce());
    expect(rtc.joinRoomCalls).toHaveLength(1);
    expect(rtc.publishLocalVideoCalls).toBe(0);
    expect(rtc.publishLocalAudioCalls).toBe(0);
    ready();
    await pending;
    expect(rtc.publishLocalVideoCalls).toBe(1);
    expect(rtc.publishLocalAudioCalls).toBe(1);
    await controller.disconnect();
  });

  it("曝光检查失败不会发布任何媒体", async () => {
    const { controller, rtc } = makeStream();
    await expect(controller.connect(connection, true, noopEnsureActive, async () => {
      throw new XmaxError(XmaxErrorCode.cameraExposureTimeout, "too dark");
    })).rejects.toMatchObject({ code: XmaxErrorCode.cameraExposureTimeout });
    expect(rtc.publishLocalVideoCalls).toBe(0);
    expect(rtc.publishLocalAudioCalls).toBe(0);
    await controller.disconnect();
  });

  it("曝光等待结束后再次校验租约，避免取消后发布", async () => {
    const { controller, rtc } = makeStream();
    let cancelled = false;
    await expect(controller.connect(connection, true, () => {
      if (cancelled) throw new XmaxError(XmaxErrorCode.cancelled, "cancelled");
    }, async () => { cancelled = true; })).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(rtc.publishLocalVideoCalls).toBe(0);
    expect(rtc.publishLocalAudioCalls).toBe(0);
    await controller.disconnect();
  });

  it("forwards network statistics after publishing without a generated stream and supports unsubscribe", async () => {
    const { controller, rtc } = makeStream();
    const listener = vi.fn();
    const stats = { uplinkQuality: 1 as const, downlinkQuality: 0 as const, uplinkRttMs: 20 };
    controller.setNetworkStatisticsListener(listener);
    rtc.eventListener?.onNetworkStatistics?.(stats);
    expect(listener).not.toHaveBeenCalled();
    await controller.connect(connection, false, noopEnsureActive);
    rtc.eventListener?.onNetworkStatistics?.(stats);
    expect(listener).toHaveBeenLastCalledWith(stats);
    controller.setNetworkStatisticsListener();
    rtc.eventListener?.onNetworkStatistics?.(stats);
    expect(listener).toHaveBeenCalledOnce();
    controller.setNetworkStatisticsListener(listener);
    await controller.disconnect();
    rtc.eventListener?.onNetworkStatistics?.(stats);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("selects the actual generated stream's metrics, not the first remote user or configured bot", async () => {
    const { controller, rtc } = makeStream();
    const listener = vi.fn();
    controller.setRemoteVideoStatisticsListener(listener);
    await controller.connect(connection, false, noopEnsureActive);
    const actual = { userID: "bot-actual", width: 1920, height: 1024, frameRate: 26, bitrateKbps: 6400, rttMs: 20, endToEndDelayMs: 87 };
    const other = { ...actual, userID: "bot001", width: 320 };
    rtc.eventListener?.onRemoteVideoStatistics?.([other, actual]);
    expect(listener).toHaveBeenLastCalledWith(undefined);

    const pending = controller.beginGeneration({ taskID: "task-stats", videoFormat, context });
    emitRemoteVideo(rtc, actual.userID, true);
    await pending;
    rtc.eventListener?.onRemoteVideoStatistics?.([other, actual]);
    expect(listener).toHaveBeenLastCalledWith(actual);
    rtc.eventListener?.onRemoteVideoStatistics?.([other]);
    expect(listener).toHaveBeenLastCalledWith(undefined);
    rtc.eventListener?.onRemoteVideoStatistics?.([actual]);
    expect(listener).toHaveBeenLastCalledWith(actual);

    emitRemoteVideo(rtc, actual.userID, false);
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(undefined));
    rtc.eventListener?.onRemoteVideoStatistics?.([actual]);
    expect(listener).toHaveBeenLastCalledWith(undefined);
    const next = { ...actual, userID: "bot-next", frameRate: 24 };
    emitRemoteVideo(rtc, next.userID, true);
    await vi.waitFor(() => expect(rtc.subscribeRemoteVideoCalls).toContainEqual([next.userID, true]));
    // 等待订阅完成、实际结果流身份更新。
    await vi.waitFor(() => {
      rtc.eventListener?.onRemoteVideoStatistics?.([actual, next]);
      expect(listener).toHaveBeenLastCalledWith(next);
    });
    await controller.disconnect();
    expect(listener).toHaveBeenLastCalledWith(undefined);
    controller.setRemoteVideoStatisticsListener();
    listener.mockClear();
    rtc.eventListener?.onRemoteVideoStatistics?.([next]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("forwards local metrics only after publishing and supports listener removal", async () => {
    const { controller, rtc } = makeStream();
    const received: unknown[] = [];
    const stats = { width: 1920, height: 1024, frameRate: 30, bitrateKbps: 6000 };
    controller.setLocalVideoStatisticsListener((value) => received.push(value));
    rtc.eventListener?.onLocalVideoStatistics?.(stats);
    expect(received).toEqual([]);
    await controller.connect(connection, false, noopEnsureActive);
    rtc.eventListener?.onLocalVideoStatistics?.(stats);
    expect(received).toEqual([stats]);
    controller.setLocalVideoStatisticsListener();
    rtc.eventListener?.onLocalVideoStatistics?.(stats);
    expect(received).toEqual([stats]);
    controller.setLocalVideoStatisticsListener((value) => received.push(value));
    await controller.disconnect();
    rtc.eventListener?.onLocalVideoStatistics?.(stats);
    expect(received).toEqual([stats]);
  });

  it("connects by joining the room and publishing local streams", async () => {
    const { controller, rtc } = makeStream();
    await controller.connect(connection, true, noopEnsureActive);

    expect(rtc.joinRoomCalls).toHaveLength(1);
    expect(rtc.publishLocalVideoCalls).toBe(1);
    expect(rtc.publishLocalAudioCalls).toBe(1);
  });

  it("skips local audio when not requested", async () => {
    const { controller, rtc } = makeStream();
    await controller.connect(connection, false, noopEnsureActive);
    expect(rtc.publishLocalVideoCalls).toBe(1);
    expect(rtc.publishLocalAudioCalls).toBe(0);
  });

  it("rolls back video publication when audio publish fails", async () => {
    const { controller, rtc } = makeStream();
    rtc.failNextPublishAudio = true;

    await expect(
      controller.connect(connection, true, noopEnsureActive),
    ).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    expect(rtc.unpublishLocalVideoCalls).toBe(1);
  });

  it("disconnects by unpublishing, unsubscribing and leaving the room", async () => {
    const { controller, rtc } = makeStream();
    await controller.connect(connection, true, noopEnsureActive);
    await controller.disconnect();

    expect(rtc.unpublishLocalAudioCalls).toBe(1);
    expect(rtc.unpublishLocalVideoCalls).toBe(1);
    expect(rtc.leaveRoomCalls).toBe(1);

    // 空闲时重复断开安全返回。
    await controller.disconnect();
    expect(rtc.leaveRoomCalls).toBe(1);
  });

  it("validates generation task before sending the start signal", async () => {
    const { controller } = makeStream();

    expect(() =>
      controller.beginGeneration({ taskID: "  ", videoFormat, context }),
    ).toThrowError(
      expect.objectContaining({ code: XmaxErrorCode.invalidConfiguration }),
    );
    expect(() =>
      controller.beginGeneration({ taskID: "task-001", videoFormat, context }),
    ).toThrowError(expect.objectContaining({ code: XmaxErrorCode.rtcError }));
  });

  it("confirms generation when the bot publishes its video stream", async () => {
    const { controller, rtc, bindings } = makeStream();
    await controller.connect(connection, false, noopEnsureActive);

    const confirmation = controller.beginGeneration({
      taskID: "task-001",
      videoFormat,
      context,
    });
    expect(controller.hasGenerationTask).toBe(true);
    expect(JSON.parse(rtc.sentMessages[0]!).event).toBe("start");

    emitRemoteVideo(rtc, "bot001", true);
    await confirmation;

    expect(rtc.subscribeRemoteVideoCalls).toEqual([["bot001", true]]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.stream.userID).toBe("bot001");
    expect(bindings[0]?.stream.roomID).toBe("100000001");
    expect(bindings[0]?.videoTrack).toBe(rtc.remoteVideoTrack);
  });

  it("ignores video publish events from non-bot users when no generation is active", async () => {
    const { controller, rtc } = makeStream();
    await controller.connect(connection, false, noopEnsureActive);

    emitRemoteVideo(rtc, "someone-else", true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rtc.subscribeRemoteVideoCalls).toHaveLength(0);
  });

  it("accepts a mismatched publisher while generation is pending", async () => {
    const { controller, rtc, bindings } = makeStream();
    await controller.connect(connection, false, noopEnsureActive);

    const confirmation = controller.beginGeneration({
      taskID: "task-001",
      videoFormat,
      context,
    });

    // 会话下发的 botID 与实际发布者不一致时，仍按生成结果流接受。
    emitRemoteVideo(rtc, "bot-other", true);
    await confirmation;

    expect(rtc.subscribeRemoteVideoCalls).toEqual([["bot-other", true]]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.stream.userID).toBe("bot-other");
  });

  it("times out generation confirmation", async () => {
    const { controller } = makeStream({ generationTimeoutMs: 5 });
    await controller.connect(connection, false, noopEnsureActive);

    const confirmation = controller.beginGeneration({
      taskID: "task-001",
      videoFormat,
      context,
    });
    await expect(confirmation).rejects.toMatchObject({
      code: XmaxErrorCode.timeout,
    });
    // 超时后任务保留，由上层决定停止；等待器已清理。
    expect(controller.hasGenerationTask).toBe(true);
  });

  it("cleans up when the start signal fails to send", async () => {
    const { controller, rtc } = makeStream();
    await controller.connect(connection, false, noopEnsureActive);
    rtc.failNextSend = true;

    expect(() =>
      controller.beginGeneration({ taskID: "task-001", videoFormat, context }),
    ).toThrowError(expect.objectContaining({ code: XmaxErrorCode.rtcError }));
    expect(controller.hasGenerationTask).toBe(false);
  });

  it("rejects a second generation while one is active", async () => {
    const { controller, rtc } = makeStream();
    await controller.connect(connection, false, noopEnsureActive);
    const confirmation = controller.beginGeneration({
      taskID: "task-001",
      videoFormat,
      context,
    });
    const settled = expect(confirmation).rejects.toMatchObject({
      code: XmaxErrorCode.cancelled,
    });

    expect(() =>
      controller.beginGeneration({ taskID: "task-002", videoFormat, context }),
    ).toThrowError(expect.objectContaining({ code: XmaxErrorCode.rtcError }));

    await controller.stopGeneration("");
    await settled;
  });

  it("stops generation by rejecting the waiter, clearing the stream and signaling stop", async () => {
    const { controller, rtc, bindings } = makeStream();
    await controller.connect(connection, false, noopEnsureActive);
    const confirmation = controller.beginGeneration({
      taskID: "task-001",
      videoFormat,
      context,
    });
    emitRemoteVideo(rtc, "bot001", true);
    await confirmation;
    await controller.activateRemoteAudio();

    await controller.stopGeneration("");

    const events = rtc.sentMessages.map((raw) => JSON.parse(raw).event);
    expect(events).toContain("stop");
    expect(bindings[bindings.length - 1]).toBeNull();
    expect(rtc.subscribeRemoteAudioCalls).toContainEqual(["bot001", false]);
    expect(controller.hasGenerationTask).toBe(false);
  });

  it.each([0, 0.4, 1])("applies volume %s before explicitly activating confirmed remote audio", async (volume) => {
    const { controller, rtc } = makeStream();
    const setVolume = vi.spyOn(rtc, "setRemoteAudioVolume");
    const subscribeAudio = vi.spyOn(rtc, "subscribeRemoteAudio");
    controller.setRemoteAudioVolume(volume);
    await controller.connect(connection, false, noopEnsureActive);

    await expect(controller.activateRemoteAudio()).rejects.toMatchObject({
      code: XmaxErrorCode.rtcError,
    });

    const confirmation = controller.beginGeneration({
      taskID: "task-001",
      videoFormat,
      context,
    });
    emitRemoteVideo(rtc, "bot001", true);
    await confirmation;

    expect(subscribeAudio).not.toHaveBeenCalled();
    await controller.activateRemoteAudio();
    expect(rtc.volumeCalls).toContainEqual([volume * 100, "bot001"]);
    expect(rtc.subscribeRemoteAudioCalls).toEqual([["bot001", true]]);
    expect(setVolume.mock.invocationCallOrder[0]).toBeLessThan(subscribeAudio.mock.invocationCallOrder[0]!);
    expect(controller.remoteAudioVolume).toBeCloseTo(volume);

    // 静音订阅后仍可以通过滑杆恢复音量，无需重新订阅。
    controller.setRemoteAudioVolume(0.65);
    expect(rtc.volumeCalls.at(-1)).toEqual([65, "bot001"]);
    expect(subscribeAudio).toHaveBeenCalledOnce();
    await controller.disconnect();
  });

  it("clears the remote stream when the bot unpublishes", async () => {
    const { controller, rtc, bindings } = makeStream();
    await controller.connect(connection, false, noopEnsureActive);
    const confirmation = controller.beginGeneration({
      taskID: "task-001",
      videoFormat,
      context,
    });
    emitRemoteVideo(rtc, "bot001", true);
    await confirmation;
    await controller.activateRemoteAudio();

    emitRemoteVideo(rtc, "bot001", false);
    // 取消发布处理是异步链路，等待其完成。
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(bindings[bindings.length - 1]).toBeNull();
    expect(rtc.subscribeRemoteAudioCalls).toContainEqual(["bot001", false]);
  });

  it("sends condition updates, target size changes and tracks through the room", async () => {
    const { controller, rtc } = makeStream();
    await controller.connect(connection, false, noopEnsureActive);

    controller.updateGeneration({ taskID: "task-001", videoFormat, context });
    controller.changeTargetSize("task-001", { width: 640, height: 960 }, noopEnsureActive);
    controller.sendTracks("task-001", [{ x: 0.1, y: 0.2 } as never]);

    const events = rtc.sentMessages.map((raw) => JSON.parse(raw).event);
    expect(events).toEqual(["change_condition", "change_target_size", "tracks"]);
  });

  it("forwards room business messages to the room listener", async () => {
    const { controller, rtc } = makeStream();
    const received: Record<string, unknown>[] = [];
    controller.setRoomListener({
      onRoomMessage: (_sender, message) => received.push(message),
    });
    await controller.connect(connection, false, noopEnsureActive);

    rtc.eventListener?.onCustomMessageReceived(
      "bot001",
      JSON.stringify({ event: "result", user_id: "rtc-user-001" }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe("result");
  });
});
