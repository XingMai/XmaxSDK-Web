import { afterEach, describe, expect, it, vi } from "vitest";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { CameraPosition } from "../src/Foundation/Media/Camera/CameraPosition";
import type { CameraControlling, CameraPreviewReadyHandler } from "../src/Media/Camera/CameraControlling";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { XmaxRealtimeManager } from "../src/Core/Realtime/XmaxRealtimeManager";
import { RealtimeContext } from "../src/Service/Realtime/RealtimeContext";
import { RealtimeMediaStream } from "../src/Service/Realtime/RealtimeMediaStream";
import { RealtimeSession } from "../src/Service/Realtime/RealtimeSession";
import { RealtimeSessionConnection } from "../src/Service/Realtime/RealtimeSessionConnection";
import type {
  RealtimeSessionHeartbeatHandlers,
  RealtimeSessionServicing,
} from "../src/Service/Realtime/RealtimeSessionServicing";
import { RealtimeConnectionState } from "../src/Service/Realtime/RealtimeState";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../src/Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../src/Service/Realtime/StreamID";
import type { RealtimeLaunchTiming } from "../src/Service/Realtime/RealtimeLaunchTiming";
import type { RemoteVideoStatisticsListener, VideoStatisticsListener } from "../src/Foundation/RTC/VideoStatistics";
import { VideoRenderRegistry } from "../src/Service/Realtime/VideoRenderBinding";
import type {
  StreamControlling,
  StreamGenerationOptions,
} from "../src/Stream/StreamControlling";

/** Node 环境没有 MediaStream，提供最小实现供渲染绑定逻辑使用。 */
class MediaStreamStub {
  private tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack): void {
    this.tracks = this.tracks.filter((item) => item !== track);
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }
}

(globalThis as Record<string, unknown>).MediaStream ??= MediaStreamStub;

/** 可控的异步结果。 */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const testVideoFormat = new RealtimeVideoFormat({
  width: 1280,
  height: 720,
  fps: 30,
});

/** 相机控制器桩：直接持有当前轨道，记录停止次数。 */
class CameraControllingStub implements CameraControlling {
  currentTrack?: RealtimeVideoTrack;
  useMicrophone = true;
  stopCalls = 0;
  previewReadyHandler?: CameraPreviewReadyHandler;

  setPreviewReadyHandler(handler?: CameraPreviewReadyHandler): void {
    this.previewReadyHandler = handler;
  }

  async createLocalCameraStream(): Promise<RealtimeMediaStream> {
    const track = new RealtimeVideoTrack({
      id: "video0",
      videoFormat: testVideoFormat,
      position: CameraPosition.front,
    });
    this.currentTrack = track;
    return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
  }

  async stopLocalCameraStream(): Promise<void> {
    this.stopCalls += 1;
    this.currentTrack = undefined;
  }

  async switchCamera(): Promise<RealtimeMediaStream> {
    const track = this.currentTrack;
    if (!track) {
      throw new XmaxError(XmaxErrorCode.rtcError, "no camera");
    }
    return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
  }

  /** 准备一条由该控制器持有的本地轨道。 */
  makeActiveTrack(): RealtimeVideoTrack {
    const track = new RealtimeVideoTrack({
      id: "video0",
      videoFormat: testVideoFormat,
      position: CameraPosition.front,
    });
    this.currentTrack = track;
    return track;
  }
}

/** 传输层桩：记录全部调用，生成确认由测试手动控制。 */
class StreamControllingStub implements StreamControlling {
  remoteVideoStatisticsListener?: RemoteVideoStatisticsListener;

  setRemoteVideoStatisticsListener(listener?: RemoteVideoStatisticsListener): void {
    this.remoteVideoStatisticsListener = listener;
  }

  localVideoStatisticsListener?: VideoStatisticsListener;

  setLocalVideoStatisticsListener(listener?: VideoStatisticsListener): void {
    this.localVideoStatisticsListener = listener;
  }

  hasGenerationTask = false;
  remoteAudioVolume = 1;

  connectCalls: { connection: RealtimeSessionConnection; includeLocalAudio: boolean }[] = [];
  disconnectCalls = 0;
  beginCalls: StreamGenerationOptions[] = [];
  updateCalls: StreamGenerationOptions[] = [];
  stopGenerationCalls: string[] = [];
  activateAudioCalls = 0;
  volumes: number[] = [];

  failConnect?: XmaxError;
  failBegin?: XmaxError;
  failEncoderConfig?: XmaxError;
  confirmationDeferreds: Deferred<void>[] = [];
  encoderConfigFormats: RealtimeVideoFormat[] = [];

  async setVideoEncoderConfig(videoFormat: RealtimeVideoFormat): Promise<void> {
    if (this.failEncoderConfig) {
      throw this.failEncoderConfig;
    }
    this.encoderConfigFormats.push(videoFormat);
  }

  async connect(
    connection: RealtimeSessionConnection,
    includeLocalAudio: boolean,
  ): Promise<void> {
    if (this.failConnect) {
      throw this.failConnect;
    }
    this.connectCalls.push({ connection, includeLocalAudio });
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  beginGeneration(options: StreamGenerationOptions): Promise<void> {
    if (this.failBegin) {
      throw this.failBegin;
    }
    this.beginCalls.push(options);
    const deferred = makeDeferred<void>();
    this.confirmationDeferreds.push(deferred);
    return deferred.promise;
  }

  async activateRemoteAudio(): Promise<void> {
    this.activateAudioCalls += 1;
  }

  updateGeneration(options: StreamGenerationOptions): void {
    this.updateCalls.push(options);
  }

  changeTargetSize(): void {}

  async stopGeneration(taskID: string): Promise<void> {
    this.stopGenerationCalls.push(taskID);
  }

  sendTracks(): void {}

  setRoomListener(): void {}

  setRemoteAudioVolume(volume: number): void {
    this.volumes.push(volume);
    this.remoteAudioVolume = volume;
  }
}

/** 会话 Service 桩：返回固定会话，记录心跳与关闭调用。 */
class RealtimeSessionServicingStub implements RealtimeSessionServicing {
  readonly session = new RealtimeSession({
    id: "session-1",
    userID: "user-1",
    status: "ACTIVE",
    connection: new RealtimeSessionConnection({
      provider: "trtc",
      roomID: "room-1",
      sdkAppID: "app-1",
      userID: "rtc-user-1",
      userSig: "sig-1",
      privateMapKey: "key-1",
      botID: "bot-1",
    }),
  });

  createCalls = 0;
  failCreate?: XmaxError;
  heartbeatSessionID?: string;
  heartbeatHandlers?: RealtimeSessionHeartbeatHandlers;
  stopHeartbeatCalls = 0;
  closedSessionIDs: string[] = [];

  async createSession(): Promise<RealtimeSession> {
    this.createCalls += 1;
    if (this.failCreate) {
      throw this.failCreate;
    }
    return this.session;
  }

  startHeartbeat(
    sessionID: string,
    handlers: RealtimeSessionHeartbeatHandlers,
  ): void {
    this.heartbeatSessionID = sessionID;
    this.heartbeatHandlers = handlers;
  }

  stopHeartbeat(): void {
    this.stopHeartbeatCalls += 1;
  }

  async closeSession(sessionID: string): Promise<void> {
    this.closedSessionIDs.push(sessionID);
  }
}

/** 组装 Manager 与各层桩。 */
function makeManager() {
  const camera = new CameraControllingStub();
  const stream = new StreamControllingStub();
  const session = new RealtimeSessionServicingStub();
  const manager = new XmaxRealtimeManager(
    new RealtimeConfiguration({ model: RealtimeModel.x2_fast_1080p }),
    {
      cameraController: camera,
      streamController: stream,
      sessionService: session,
    },
  );
  return { manager, camera, stream, session };
}

/** 准备本地流并返回。 */
function makeLocalStream(camera: CameraControllingStub): RealtimeMediaStream {
  const track = camera.makeActiveTrack();
  return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
}

const testContext = new RealtimeContext({ prompt: "a red cube" });

describe("XmaxRealtimeManager remote video statistics", () => {
  it("replays snapshots and clears missing or stopped result metrics without accepting late updates", async () => {
    const { manager, camera, stream } = makeManager();
    const listener = vi.fn();
    const stats = { userID: "bot-1", width: 1920, height: 1024, frameRate: 26, bitrateKbps: 6400, rttMs: 20, endToEndDelayMs: 87 };
    await manager.setRemoteVideoStatisticsListener(listener);
    expect(listener).toHaveBeenLastCalledWith(undefined);
    stream.remoteVideoStatisticsListener?.(stats);
    expect(listener).toHaveBeenCalledTimes(1);
    const localStream = makeLocalStream(camera);
    await manager.connect(localStream);
    stream.remoteVideoStatisticsListener?.(stats);
    expect(listener).toHaveBeenLastCalledWith(stats);
    expect(Object.isFrozen(listener.mock.calls.at(-1)![0])).toBe(true);
    const replay = vi.fn();
    await manager.setRemoteVideoStatisticsListener(replay);
    expect(replay).toHaveBeenLastCalledWith(stats);
    stream.remoteVideoStatisticsListener?.(undefined);
    expect(replay).toHaveBeenLastCalledWith(undefined);
    stream.remoteVideoStatisticsListener?.(stats);

    const disconnecting = manager.disconnect();
    stream.remoteVideoStatisticsListener?.(stats);
    await disconnecting;
    expect(replay).toHaveBeenLastCalledWith(undefined);
    expect(replay).toHaveBeenCalledTimes(4);
    await manager.connect(localStream);
    stream.remoteVideoStatisticsListener?.({ ...stats, endToEndDelayMs: undefined });
    expect(replay).toHaveBeenLastCalledWith({ ...stats, endToEndDelayMs: undefined });
    const closing = manager.close();
    stream.remoteVideoStatisticsListener?.(stats);
    await closing;
    expect(replay).toHaveBeenLastCalledWith(undefined);
    expect(replay).toHaveBeenCalledTimes(6);
  });

  it.each([false, true])("isolates remote metric observer failures and supports unsubscribe (async: %s)", async (asyncListener) => {
    const { manager, camera, stream } = makeManager();
    const fail = vi.fn(() => { throw new Error("observer failed"); });
    await manager.setRemoteVideoStatisticsListener(asyncListener ? async () => fail() : fail);
    await manager.connect(makeLocalStream(camera));
    expect(() => stream.remoteVideoStatisticsListener?.({ userID: "bot-1", rttMs: 0, endToEndDelayMs: 0 })).not.toThrow();
    expect(fail).toHaveBeenCalledTimes(2);
    await manager.setRemoteVideoStatisticsListener();
    stream.remoteVideoStatisticsListener?.({ userID: "bot-1", frameRate: 30 });
    expect(fail).toHaveBeenCalledTimes(2);
    await manager.close();
  });
});

describe("XmaxRealtimeManager local video statistics", () => {
  it("replays immutable snapshots, clears on disconnect, and ignores late callbacks", async () => {
    const { manager, camera, stream } = makeManager();
    const stats = { width: 1920, height: 1024, frameRate: 30, bitrateKbps: 6006.51 };
    const listener = vi.fn();
    await manager.setLocalVideoStatisticsListener(listener);
    expect(listener).toHaveBeenLastCalledWith(undefined);
    stream.localVideoStatisticsListener?.(stats);
    expect(listener).toHaveBeenCalledTimes(1);
    const localStream = makeLocalStream(camera);
    await manager.connect(localStream);
    stream.localVideoStatisticsListener?.(stats);
    expect(listener).toHaveBeenLastCalledWith(stats);
    expect(Object.isFrozen(listener.mock.calls.at(-1)![0])).toBe(true);
    const replay = vi.fn();
    await manager.setLocalVideoStatisticsListener(replay);
    expect(replay).toHaveBeenLastCalledWith(stats);

    const disconnecting = manager.disconnect();
    expect(replay).toHaveBeenLastCalledWith(undefined);
    stream.localVideoStatisticsListener?.(stats);
    await disconnecting;
    expect(replay).toHaveBeenCalledTimes(2);

    await manager.connect(localStream);
    stream.localVideoStatisticsListener?.({ ...stats, frameRate: 25 });
    expect(replay).toHaveBeenLastCalledWith({ ...stats, frameRate: 25 });
    const closing = manager.close();
    stream.localVideoStatisticsListener?.(stats);
    await closing;
    expect(replay).toHaveBeenLastCalledWith(undefined);
    expect(replay).toHaveBeenCalledTimes(4);
  });

  it.each([false, true])("isolates throwing observers and supports unsubscribe (async: %s)", async (asyncListener) => {
    const { manager, camera, stream } = makeManager();
    const fail = vi.fn(() => { throw new Error("observer failed"); });
    await manager.setLocalVideoStatisticsListener(asyncListener ? async () => fail() : fail);
    await manager.connect(makeLocalStream(camera));
    expect(() => stream.localVideoStatisticsListener?.({ frameRate: 0, bitrateKbps: 0 })).not.toThrow();
    expect(fail).toHaveBeenCalledTimes(2);
    await manager.setLocalVideoStatisticsListener();
    stream.localVideoStatisticsListener?.({ frameRate: 30 });
    expect(fail).toHaveBeenCalledTimes(2);
    await manager.close();
  });
});

describe("XmaxRealtimeManager launch timing", () => {
  afterEach(() => vi.restoreAllMocks());

  const cameraOptions = {
    videoFormat: testVideoFormat,
    position: CameraPosition.front,
    useMicrophone: false,
  };

  it("分阶段回调：连接包含会话、编码和进房发布，首帧独立于生成返回", async () => {
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { manager, camera, session, stream } = makeManager();
    const snapshots: RealtimeLaunchTiming[] = [];
    await manager.setLaunchTimingListener((timing) => snapshots.push(timing));
    expect(snapshots).toEqual([{}]);

    const createCamera = camera.createLocalCameraStream.bind(camera);
    vi.spyOn(camera, "createLocalCameraStream").mockImplementation(async () => {
      now += 250;
      return createCamera();
    });
    vi.spyOn(session, "createSession").mockImplementation(async () => {
      now += 120;
      return session.session;
    });
    vi.spyOn(stream, "setVideoEncoderConfig").mockImplementation(async () => { now += 30; });
    vi.spyOn(stream, "connect").mockImplementation(async () => { now += 350; });

    const localStream = await manager.createLocalCameraStream(cameraOptions);
    const pending = manager.startGeneration({ localStream, context: testContext });
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    stream.confirmationDeferreds[0]!.resolve();
    const remote = await pending;

    // 即使没有挂载视图，生成仍能返回；此时不能伪报首帧和总耗时。
    expect(snapshots).toEqual([{}, {}, { cameraMs: 250 }, { cameraMs: 250, connectionMs: 500 }]);
    const onFrame = VideoRenderRegistry.binding(remote.videoTrack!)!.frameDisplayHandler!;
    now = 1250;
    onFrame();
    expect(snapshots.at(-1)).toEqual({ cameraMs: 250, connectionMs: 500, firstFrameMs: 400, totalMs: 1150 });
    expect(Object.isFrozen(snapshots.at(-1))).toBe(true);

    now = 1500;
    onFrame();
    await manager.startGeneration({ localStream, context: new RealtimeContext({ prompt: "updated" }) });
    expect(snapshots).toHaveLength(5);
    expect(stream.beginCalls).toHaveLength(1);
    const replay = vi.fn();
    await manager.setLaunchTimingListener(replay);
    expect(replay).toHaveBeenCalledWith(snapshots.at(-1));
    await manager.setLaunchTimingListener();
    await manager.close();
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("停止后保留部分统计，重启清空，旧轨道的迟到首帧无效", async () => {
    const { manager, stream } = makeManager();
    const listener = vi.fn();
    await manager.setLaunchTimingListener(listener);
    const localStream = await manager.createLocalCameraStream(cameraOptions);
    const pending = manager.startGeneration({ localStream, context: testContext });
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    stream.confirmationDeferreds[0]!.resolve();
    const remote = await pending;
    const oldFrame = VideoRenderRegistry.binding(remote.videoTrack!)!.frameDisplayHandler!;
    const partial = listener.mock.calls.at(-1)![0];
    await manager.close();
    oldFrame();
    expect(listener.mock.calls.at(-1)![0]).toBe(partial);
    expect(partial.firstFrameMs).toBeUndefined();

    listener.mockClear();
    await manager.createLocalCameraStream(cameraOptions);
    expect(listener.mock.calls[0]![0]).toEqual({});
    oldFrame();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]![0]).toEqual({ cameraMs: expect.any(Number) });
    await manager.close();
  });

  it("进房失败时不提交连接和总耗时", async () => {
    const { manager, stream } = makeManager();
    const listener = vi.fn();
    await manager.setLaunchTimingListener(listener);
    const localStream = await manager.createLocalCameraStream(cameraOptions);
    stream.failConnect = new XmaxError(XmaxErrorCode.rtcError, "join failed");
    await expect(manager.startGeneration({ localStream, context: testContext })).rejects.toThrow("join failed");
    expect(listener.mock.calls.at(-1)![0]).toEqual({ cameraMs: expect.any(Number) });
    await manager.close();
  });

  it("生成取消后不提交迟到的首帧", async () => {
    const { manager, stream } = makeManager();
    const listener = vi.fn();
    await manager.setLaunchTimingListener(listener);
    const localStream = await manager.createLocalCameraStream(cameraOptions);
    const remote = await manager.connect(localStream);
    const onFrame = VideoRenderRegistry.binding(remote.videoTrack!)!.frameDisplayHandler!;
    const pending = manager.startGeneration({ localStream, context: testContext });
    const rejected = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    const stopping = manager.disconnect();
    onFrame();
    stream.confirmationDeferreds[0]!.resolve();
    await stopping;
    await rejected;
    expect(listener.mock.calls.at(-1)![0]).toEqual({ cameraMs: expect.any(Number), connectionMs: expect.any(Number) });
    await manager.close();
  });

  it.each([false, true])("监听器抛错不影响相机和连接（异步：%s）", async (asyncListener) => {
    const { manager } = makeManager();
    const fail = () => { throw new Error("observer failed"); };
    await manager.setLaunchTimingListener(asyncListener ? async () => fail() : fail);
    const localStream = await manager.createLocalCameraStream(cameraOptions);
    await manager.connect(localStream);
    expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.connected);
    await manager.close();
  });
});

describe("XmaxRealtimeManager connect", () => {
  it("建立连接：创建会话、进房发布、启动心跳并进入 connected", async () => {
    const { manager, camera, stream, session } = makeManager();
    const localStream = makeLocalStream(camera);

    const states: RealtimeConnectionState[] = [];
    await manager.setStateListener((state) => {
      states.push(state.connectionState);
    });

    const remote = await manager.connect(localStream);

    expect(session.createCalls).toBe(1);
    expect(stream.connectCalls).toHaveLength(1);
    expect(stream.connectCalls[0]!.connection.roomID).toBe("room-1");
    expect(stream.connectCalls[0]!.includeLocalAudio).toBe(true);
    expect(session.heartbeatSessionID).toBe("session-1");
    // 远端音量配置在连接建立后同步给传输层。
    expect(stream.volumes).toContain(0);

    expect(remote.id).toBe(StreamID.remote);
    expect(remote.videoTrack?.id).toBe("bot-1");
    expect(manager.currentState.connectionState).toBe(
      RealtimeConnectionState.connected,
    );
    expect(manager.currentState.sessionID).toBe("session-1");
    expect(states).toEqual([
      RealtimeConnectionState.idle,
      RealtimeConnectionState.connecting,
      RealtimeConnectionState.connected,
    ]);
  });

  it("拒绝连接不属于当前 Manager 的本地流", async () => {
    const { manager, camera } = makeManager();
    makeLocalStream(camera);
    const foreignStream = new RealtimeMediaStream({
      id: StreamID.local,
      videoTrack: new RealtimeVideoTrack({ id: "video0" }),
    });

    await expect(manager.connect(foreignStream)).rejects.toMatchObject({
      code: XmaxErrorCode.invalidConfiguration,
    });
    expect(manager.currentState.connectionState).toBe(
      RealtimeConnectionState.idle,
    );
  });

  it("已有活动连接时拒绝重复连接", async () => {
    const { manager, camera } = makeManager();
    const localStream = makeLocalStream(camera);
    await manager.connect(localStream);

    await expect(manager.connect(localStream)).rejects.toMatchObject({
      code: XmaxErrorCode.invalidConfiguration,
    });
  });

  it("未配置 API 服务时拒绝连接", async () => {
    const camera = new CameraControllingStub();
    const manager = new XmaxRealtimeManager(
      new RealtimeConfiguration({ model: RealtimeModel.x2_fast_1080p }),
      { cameraController: camera },
    );
    const localStream = makeLocalStream(camera);

    await expect(manager.connect(localStream)).rejects.toMatchObject({
      code: XmaxErrorCode.invalidConfiguration,
    });
  });

  it("会话创建失败：清理连接资源并恢复本地预览状态", async () => {
    const { manager, camera, stream, session } = makeManager();
    const localStream = makeLocalStream(camera);
    session.failCreate = new XmaxError(XmaxErrorCode.sessionError, "boom");

    await expect(manager.connect(localStream)).rejects.toMatchObject({
      code: XmaxErrorCode.sessionError,
    });

    expect(session.stopHeartbeatCalls).toBeGreaterThan(0);
    // 协调器清理可能执行多次，断开调用至少一次。
    expect(stream.disconnectCalls).toBeGreaterThan(0);
    // 会话未创建成功，无需关闭。
    expect(session.closedSessionIDs).toHaveLength(0);
    // 本地媒体仍在，最终状态回到 ready 并携带失败原因。
    expect(manager.currentState.connectionState).toBe(
      RealtimeConnectionState.ready,
    );
    expect(manager.currentState.reason?.kind).toBe("failure");
  });
});

describe("XmaxRealtimeManager startGeneration", () => {
  it("按需连接并开始生成：确认后激活远端音频并进入 generating", async () => {
    const { manager, camera, stream } = makeManager();
    const localStream = makeLocalStream(camera);

    const pending = manager.startGeneration({
      localStream,
      context: testContext,
    });
    await vi.waitFor(() => {
      expect(stream.beginCalls).toHaveLength(1);
    });

    const begin = stream.beginCalls[0]!;
    expect(begin.taskID).toMatch(/^task-.+\?os=web$/);
    expect(begin.videoFormat).toBe(testVideoFormat);
    expect(begin.context).toBe(testContext);

    stream.confirmationDeferreds[0]!.resolve();
    const remote = await pending;

    expect(stream.activateAudioCalls).toBe(1);
    expect(remote.videoTrack?.id).toBe("bot-1");
    expect(manager.currentState.connectionState).toBe(
      RealtimeConnectionState.generating,
    );
    expect(manager.currentState.sessionID).toBe("session-1");
    expect(manager.currentState.taskID).toBe(begin.taskID);
  });

  it("生成中再次调用仅更新生成条件", async () => {
    const { manager, camera, stream } = makeManager();
    const localStream = makeLocalStream(camera);

    const pending = manager.startGeneration({
      localStream,
      context: testContext,
    });
    await vi.waitFor(() => {
      expect(stream.beginCalls).toHaveLength(1);
    });
    stream.confirmationDeferreds[0]!.resolve();
    await pending;

    const nextContext = new RealtimeContext({ prompt: "a blue sphere" });
    const remote = await manager.startGeneration({
      localStream,
      context: nextContext,
    });

    expect(stream.beginCalls).toHaveLength(1);
    expect(stream.updateCalls).toHaveLength(1);
    expect(stream.updateCalls[0]!.context).toBe(nextContext);
    expect(stream.updateCalls[0]!.taskID).toBe(manager.currentState.taskID);
    expect(remote.videoTrack?.id).toBe("bot-1");
    expect(manager.currentState.connectionState).toBe(
      RealtimeConnectionState.generating,
    );
  });

  it("生成中缺省条件时复用缓存的上下文", async () => {
    const { manager, camera, stream } = makeManager();
    const localStream = makeLocalStream(camera);

    const pending = manager.startGeneration({
      localStream,
      context: testContext,
    });
    await vi.waitFor(() => {
      expect(stream.beginCalls).toHaveLength(1);
    });
    stream.confirmationDeferreds[0]!.resolve();
    await pending;

    await manager.startGeneration({ localStream });
    expect(stream.updateCalls).toHaveLength(1);
    expect(stream.updateCalls[0]!.context).toBe(testContext);
  });

  it("首次生成缺少条件上下文时拒绝", async () => {
    const { manager, camera, stream, session } = makeManager();
    const localStream = makeLocalStream(camera);

    await expect(manager.startGeneration({ localStream })).rejects.toMatchObject(
      { code: XmaxErrorCode.invalidConfiguration },
    );
    expect(session.createCalls).toBe(0);
    expect(stream.beginCalls).toHaveLength(0);
  });

  it("开始信令发送失败：清理连接资源", async () => {
    const { manager, camera, stream, session } = makeManager();
    const localStream = makeLocalStream(camera);
    stream.failBegin = new XmaxError(XmaxErrorCode.rtcError, "send failed");

    await expect(
      manager.startGeneration({ localStream, context: testContext }),
    ).rejects.toMatchObject({ code: XmaxErrorCode.rtcError });

    expect(stream.disconnectCalls).toBeGreaterThan(0);
    expect(session.closedSessionIDs).toEqual(["session-1"]);
    expect(manager.currentState.connectionState).toBe(
      RealtimeConnectionState.ready,
    );
    expect(manager.currentState.reason?.kind).toBe("failure");
  });

  it("生成确认失败：停止生成任务并清理连接", async () => {
    const { manager, camera, stream, session } = makeManager();
    const localStream = makeLocalStream(camera);

    const pending = manager.startGeneration({
      localStream,
      context: testContext,
    });
    // 拒绝确认 Promise，避免未处理拒绝告警。
    const assertion = expect(pending).rejects.toMatchObject({
      code: XmaxErrorCode.timeout,
    });
    await vi.waitFor(() => {
      expect(stream.beginCalls).toHaveLength(1);
    });
    stream.confirmationDeferreds[0]!.reject(
      new XmaxError(XmaxErrorCode.timeout, "timed out"),
    );
    await assertion;

    const taskID = stream.beginCalls[0]!.taskID;
    expect(stream.stopGenerationCalls).toContain(taskID);
    expect(session.closedSessionIDs).toEqual(["session-1"]);
    expect(manager.currentState.connectionState).toBe(
      RealtimeConnectionState.ready,
    );
  });
});

describe("XmaxRealtimeManager 断连与关闭", () => {
  it("心跳失败：结束连接并释放会话资源", async () => {
    const { manager, camera, stream, session } = makeManager();
    const localStream = makeLocalStream(camera);
    await manager.connect(localStream);

    session.heartbeatHandlers?.onFailure(
      "session-1",
      new XmaxError(XmaxErrorCode.sessionError, "heartbeat failed"),
    );
    await vi.waitFor(() => {
      expect(manager.currentState.connectionState).toBe(
        RealtimeConnectionState.ready,
      );
    });

    expect(stream.disconnectCalls).toBe(1);
    expect(session.closedSessionIDs).toEqual(["session-1"]);
    expect(manager.currentState.reason?.kind).toBe("failure");
  });

  it("心跳凭据刷新：房间绑定不变时覆盖缓存会话", async () => {
    const { manager, camera, session } = makeManager();
    const localStream = makeLocalStream(camera);
    await manager.connect(localStream);

    session.heartbeatHandlers?.onRefresh?.(
      new RealtimeSession({
        id: "session-1",
        status: "ACTIVE",
        connection: new RealtimeSessionConnection({
          provider: "trtc",
          roomID: "room-1",
          sdkAppID: "app-1",
          userID: "rtc-user-1",
          userSig: "sig-2",
          privateMapKey: "key-2",
          botID: "bot-1",
        }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 仅凭据变化不结束连接。
    expect(manager.currentState.connectionState).toBe(
      RealtimeConnectionState.connected,
    );
  });

  it("心跳凭据刷新：房间绑定变化时按失败结束连接", async () => {
    const { manager, camera, session } = makeManager();
    const localStream = makeLocalStream(camera);
    await manager.connect(localStream);

    session.heartbeatHandlers?.onRefresh?.(
      new RealtimeSession({
        id: "session-1",
        status: "ACTIVE",
        connection: new RealtimeSessionConnection({
          provider: "trtc",
          roomID: "room-2",
          sdkAppID: "app-1",
          userID: "rtc-user-1",
          userSig: "sig-2",
          privateMapKey: "key-2",
          botID: "bot-1",
        }),
      }),
    );
    await vi.waitFor(() => {
      expect(manager.currentState.connectionState).toBe(
        RealtimeConnectionState.ready,
      );
    });
    expect(manager.currentState.reason?.kind).toBe("failure");
  });

  it("断开连接：离开房间并关闭会话，保留本地预览", async () => {
    const { manager, camera, stream, session } = makeManager();
    const localStream = makeLocalStream(camera);
    await manager.connect(localStream);

    await manager.disconnect();

    expect(stream.disconnectCalls).toBe(1);
    expect(session.closedSessionIDs).toEqual(["session-1"]);
    expect(camera.stopCalls).toBe(0);
    expect(manager.currentState.connectionState).toBe(
      RealtimeConnectionState.ready,
    );
  });

  it("关闭：释放连接并停止本地相机流", async () => {
    const { manager, camera, stream, session } = makeManager();
    const localStream = makeLocalStream(camera);
    await manager.connect(localStream);

    await manager.close();

    expect(stream.disconnectCalls).toBe(1);
    expect(session.closedSessionIDs).toEqual(["session-1"]);
    expect(camera.stopCalls).toBe(1);
    expect(manager.currentState.connectionState).toBe(
      RealtimeConnectionState.idle,
    );
  });
});
