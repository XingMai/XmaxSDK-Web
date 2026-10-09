import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";
import type { RtcManaging } from "../src/Foundation/RTC/RtcManaging";
import { LocalVideoController } from "../src/Media/Video/LocalVideoController";
import { RealtimeVideoSampleMethod } from "../src/Service/Realtime/RealtimeReferenceVideo";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NetworkStatisticsListener } from "../src/Foundation/RTC/NetworkStatistics";
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
import type { RemoteFrameInterpolationOptions } from "../src/Render/Video/RemoteVideoFramePipeline";
import { VideoContentMode } from "../src/Foundation/Media/Video/VideoContentMode";
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
  isFrameValidationEnabled = true;
  stopCalls = 0;
  previewReadyHandler?: CameraPreviewReadyHandler;
  waitForValidCameraFrame = vi.fn(async (_signal: AbortSignal): Promise<void> => {});

  setPreviewReadyHandler(handler?: CameraPreviewReadyHandler): void {
    this.previewReadyHandler = handler;
  }

  async createLocalCameraStream(options?: { enableFrameValidation?: boolean }): Promise<RealtimeMediaStream> {
    this.isFrameValidationEnabled = options?.enableFrameValidation ?? true;
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
  activateNetworkVideoCompletion = vi.fn((_onFinish?: () => void): void => {});
  async updateCredentials(): Promise<void> {}
  networkStatisticsListener?: NetworkStatisticsListener;

  setNetworkStatisticsListener(listener?: NetworkStatisticsListener): void {
    this.networkStatisticsListener = listener;
  }

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

  connectCalls: { connection: RealtimeSessionConnection; includeLocalAudio: boolean; publishLocalMedia: boolean }[] = [];
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
    ensureActive: () => void,
    beforePublish?: () => Promise<void>,
    publishLocalMedia = true,
  ): Promise<void> {
    if (this.failConnect) {
      throw this.failConnect;
    }
    this.connectCalls.push({ connection, includeLocalAudio, publishLocalMedia });
    if (publishLocalMedia) {
      await beforePublish?.();
    }
    ensureActive();
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

  async updateGeneration(options: StreamGenerationOptions): Promise<void> {
    this.updateCalls.push(options);
  }

  changeTargetSize = vi.fn();

  async stopGeneration(taskID: string): Promise<void> {
    this.stopGenerationCalls.push(taskID);
  }

  async sendTracks(): Promise<void> {}

  setRoomListener(): void {}

  setRemoteAudioVolume(volume: number): void {
    this.volumes.push(volume);
    this.remoteAudioVolume = volume;
  }
}

/** 会话 Service 桩：返回固定会话，记录心跳与关闭调用。 */
class RealtimeSessionServicingStub implements RealtimeSessionServicing {
  async heartbeatSession(): Promise<RealtimeSession> { return this.session; }
  readonly session = new RealtimeSession({
    id: "session-1",
    userID: "user-1",
    status: "ACTIVE",
    connection: new RealtimeSessionConnection({
      provider: RtcProvider.trtc,
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
function makeManager(supportsFrameInterpolation?: () => Promise<boolean>, interpolationEnabled = false, model = RealtimeModel.x2_0_trtc) {
  const camera = new CameraControllingStub();
  const stream = new StreamControllingStub();
  const session = new RealtimeSessionServicingStub();
  const rtc = {
    initialize: vi.fn(async () => {}), destroy: vi.fn(async () => {}),
    setExternalMediaTracks: vi.fn(async (_tracks: { videoTrack: MediaStreamTrack; audioTrack?: MediaStreamTrack }) => {}),
  };
  const manager = new XmaxRealtimeManager(
    new RealtimeConfiguration({ model, isFrameInterpolationEnabled: interpolationEnabled }),
    {
      cameraController: camera,
      streamController: stream,
      sessionService: session,
      supportsFrameInterpolation,
      rtcManager: rtc as unknown as RtcManaging,
    },
  );
  return { manager, camera, stream, session, rtc };
}

/** 准备本地流并返回。 */
function makeLocalStream(camera: CameraControllingStub): RealtimeMediaStream {
  const track = camera.makeActiveTrack();
  return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
}

const testContext = new RealtimeContext({ prompt: "a red cube" });

describe("XmaxRealtimeManager local video", () => {
  afterEach(() => vi.restoreAllMocks());
  const options = {
    file: new Blob(["video fixture"]),
    videoFormat: new RealtimeVideoFormat({ width: 1920, height: 1024, fps: 30 }),
  };

  function setupFile(includeAudio = true, provider = RtcProvider.agora) {
    const video = { kind: "video" } as MediaStreamTrack;
    const audio = { kind: "audio" } as MediaStreamTrack;
    const track = new RealtimeVideoTrack({ id: "local-file", videoFormat: options.videoFormat });
    track.mediaStreamTrack = video;
    let active = false;
    vi.spyOn(LocalVideoController.prototype, "currentTrack", "get").mockImplementation(() => active ? track : undefined);
    vi.spyOn(LocalVideoController.prototype, "isActive", "get").mockImplementation(() => active);
    vi.spyOn(LocalVideoController.prototype, "audioTrack", "get").mockImplementation(() => active && includeAudio ? audio : undefined);
    const create = vi.spyOn(LocalVideoController.prototype, "create").mockImplementation(async () => {
      active = true;
      return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
    });
    const start = vi.spyOn(LocalVideoController.prototype, "start").mockResolvedValue();
    const pause = vi.spyOn(LocalVideoController.prototype, "pause").mockImplementation(() => {});
    const stop = vi.spyOn(LocalVideoController.prototype, "stop").mockImplementation(async () => { active = false; });
    const model = { [RtcProvider.trtc]: RealtimeModel.x2_0_trtc, [RtcProvider.agora]: RealtimeModel.x2_0_agora, [RtcProvider.vertc]: RealtimeModel.x2_1_preview }[provider];
    const s = makeManager(undefined, false, model);
    if (provider !== RtcProvider.trtc) {
      vi.spyOn(s.session, "createSession").mockResolvedValue(new RealtimeSession({
        id: "session-file", connection: { provider, roomID: "room", appID: "app", userID: "user", roomToken: "token", botID: "bot" },
      }));
    }
    return { ...s, video, audio, track, create, start, pause, stop };
  }

  it.each([
    [RtcProvider.trtc, true], [RtcProvider.trtc, false],
    [RtcProvider.agora, true], [RtcProvider.agora, false],
    [RtcProvider.vertc, true], [RtcProvider.vertc, false],
  ] as const)("publishes file tracks and plays only after the start signal; provider=%s, includeAudio=%s", async (provider, includeAudio) => {
    const s = setupFile(includeAudio, provider);
    const local = await s.manager.createLocalVideoStream({ ...options, includeAudio });
    expect(s.rtc.setExternalMediaTracks).toHaveBeenCalledWith({ videoTrack: s.video, audioTrack: includeAudio ? s.audio : undefined });
    expect(s.manager.currentState.connectionState).toBe(RealtimeConnectionState.ready);
    expect(s.start).not.toHaveBeenCalled();
    await s.manager.connect(local);
    expect(s.stream.connectCalls[0]).toMatchObject({ includeLocalAudio: includeAudio, publishLocalMedia: true });
    expect(s.stream.encoderConfigFormats).toEqual([options.videoFormat]);
    expect(s.camera.waitForValidCameraFrame).not.toHaveBeenCalled();
    expect(s.start).not.toHaveBeenCalled();

    const generating = s.manager.startGeneration({ localStream: local, context: testContext });
    await vi.waitFor(() => expect(s.stream.beginCalls).toHaveLength(1));
    expect(s.start).not.toHaveBeenCalled();
    await s.stream.beginCalls[0]!.onStartSent!();
    expect(s.start).toHaveBeenCalledOnce();
    s.stream.confirmationDeferreds[0]!.resolve();
    await generating;
    await s.manager.startGeneration({ localStream: local, context: new RealtimeContext({ prompt: "updated" }) });
    expect(s.start).toHaveBeenCalledOnce();
    await s.manager.stopLocalCameraStream();
    expect(s.stop).not.toHaveBeenCalled();
    const format = new RealtimeVideoFormat({ width: 960, height: 512, fps: 20 });
    await s.manager.updateVideoFormat(format);
    expect(s.track.videoFormat).toBe(format);

    await s.manager.disconnect();
    expect(s.pause).toHaveBeenCalled();
    expect(s.stop).not.toHaveBeenCalled();
    expect(s.manager.currentState.connectionState).toBe(RealtimeConnectionState.ready);
    await s.manager.close();
    expect(s.stop).toHaveBeenCalledOnce();
    expect(s.rtc.destroy).toHaveBeenCalledOnce();
  });

  it("rejects adapters without external track support before creating resources", async () => {
    const s = makeManager();
    Object.assign(s.rtc, { setExternalMediaTracks: undefined });
    const create = vi.spyOn(LocalVideoController.prototype, "create");
    await expect(s.manager.createLocalVideoStream(options)).rejects.toThrow("does not support local video");
    expect(create).not.toHaveBeenCalled();
    expect(s.rtc.initialize).not.toHaveBeenCalled();
  });

  it("cleans up file and engine on custom track registration failure", async () => {
    const s = setupFile();
    s.rtc.setExternalMediaTracks.mockRejectedValueOnce(new Error("custom track failed"));
    await expect(s.manager.createLocalVideoStream(options)).rejects.toThrow("custom track failed");
    expect(s.stop).toHaveBeenCalledOnce();
    expect(s.rtc.destroy).toHaveBeenCalledOnce();
    expect(s.manager.currentState.connectionState).toBe(RealtimeConnectionState.idle);
    await s.manager.createLocalVideoStream(options);
    await s.manager.close();
  });
});

describe("XmaxRealtimeManager network video", () => {
  const options = {
    url: "https://example.com/video.mp4",
    videoFormat: new RealtimeVideoFormat({ width: 1920, height: 1024, fps: 30 }),
  };

  it("joins receive-only, sends the source, retains preview on disconnect and releases it on close", async () => {
    const { manager, camera, stream, rtc } = makeManager();
    const timings: RealtimeLaunchTiming[] = [];
    await manager.setLaunchTimingListener(timing => { timings.push(timing); });
    const onFinish = vi.fn();
    const localStream = await manager.createNetworkVideoStream({ ...options, onFinish });
    expect(rtc.initialize).toHaveBeenCalledOnce();
    expect(camera.currentTrack).toBeUndefined();
    expect(localStream.videoTrack?.mediaStreamTrack).toBeUndefined();
    expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.ready);

    const starting = manager.startGeneration({ localStream, context: testContext });
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    expect(stream.connectCalls[0]).toMatchObject({ includeLocalAudio: false, publishLocalMedia: false });
    expect(stream.encoderConfigFormats).toEqual([]);
    expect(camera.waitForValidCameraFrame).not.toHaveBeenCalled();
    expect(stream.beginCalls[0]!.context.referenceVideo).toEqual({ path: options.url, sampleMethod: RealtimeVideoSampleMethod.time });
    stream.confirmationDeferreds[0]!.resolve();
    await starting;
    expect(stream.activateAudioCalls).toBe(1);
    const callback = stream.activateNetworkVideoCompletion.mock.calls[0]![0]!;
    callback();
    expect(onFinish).toHaveBeenCalledOnce();
    expect(timings.at(-1)?.connectionMs).toBeTypeOf("number");
    expect(timings.at(-1)?.cameraMs).toBeUndefined();
    expect(timings.at(-1)?.publishMs).toBeUndefined();

    await manager.stopLocalCameraStream();
    expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.generating);
    await manager.disconnect();
    callback();
    expect(onFinish).toHaveBeenCalledOnce();
    expect(VideoRenderRegistry.binding(localStream.videoTrack!)).toBeDefined();
    expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.ready);
    await manager.connect(localStream);
    expect(stream.connectCalls[1]!.publishLocalMedia).toBe(false);
    await manager.close();
    expect(VideoRenderRegistry.binding(localStream.videoTrack!)).toBeUndefined();
    expect(rtc.destroy).toHaveBeenCalledOnce();
    await expect(manager.connect(localStream)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
  });

  it("rejects overlapping sources and uplink changes without disturbing the active source", async () => {
    const { manager, camera } = makeManager();
    const local = await manager.createNetworkVideoStream(options);
    await expect(manager.createNetworkVideoStream(options)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    await expect(manager.createLocalCameraStream({ videoFormat: options.videoFormat, position: CameraPosition.front, useMicrophone: false })).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    await expect(manager.updateVideoFormat(options.videoFormat)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(VideoRenderRegistry.binding(local.videoTrack!)).toBeDefined();
    expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.ready);
    await manager.close();
    makeLocalStream(camera);
    await expect(manager.createNetworkVideoStream(options)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    await manager.close();
  });

  it("cleans up failed initialization and allows a retry", async () => {
    const { manager, rtc } = makeManager();
    rtc.initialize.mockRejectedValueOnce(new Error("init failed"));
    await expect(manager.createNetworkVideoStream(options)).rejects.toThrow("init failed");
    expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.idle);
    await manager.createNetworkVideoStream(options);
    await manager.close();
  });

  it("preserves the source after a failed connection", async () => {
    const { manager, session } = makeManager();
    const local = await manager.createNetworkVideoStream(options);
    session.failCreate = new XmaxError(XmaxErrorCode.sessionError, "failed");
    await expect(manager.connect(local)).rejects.toThrow("failed");
    expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.ready);
    expect(VideoRenderRegistry.binding(local.videoTrack!)).toBeDefined();
    session.failCreate = undefined;
    await manager.connect(local);
    await manager.close();
  });

  it("cancels creation on close and releases an engine that finishes initializing late", async () => {
    const { manager, rtc } = makeManager();
    const initialization = makeDeferred<void>();
    rtc.initialize.mockReturnValueOnce(initialization.promise);
    const creation = manager.createNetworkVideoStream(options);
    const rejected = expect(creation).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    const closing = manager.close();
    initialization.resolve();
    await Promise.all([rejected, closing]);
    expect(rtc.destroy).toHaveBeenCalledOnce();
    expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.idle);
    await manager.createNetworkVideoStream(options);
    await manager.close();
  });
});

describe("XmaxRealtimeManager video format updates", () => {
  const updatedFormat = new RealtimeVideoFormat({
    width: 640, height: 360, fps: 20, minimumBitrate: 300, maximumBitrate: 1200,
  });

  it("requires a local camera stream", async () => {
    const { manager, stream } = makeManager();
    await expect(manager.updateVideoFormat(updatedFormat)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(stream.encoderConfigFormats).toHaveLength(0);
  });

  it("applies before connection and retains upstream settings across reconnects without resizing the result", async () => {
    const { manager, camera, stream } = makeManager();
    const localStream = makeLocalStream(camera);
    await manager.updateVideoFormat(updatedFormat);
    expect(localStream.videoTrack!.videoFormat).toBe(updatedFormat);
    expect(stream.encoderConfigFormats).toEqual([updatedFormat]);
    expect(stream.connectCalls).toHaveLength(0);

    const remote = await manager.connect(localStream);
    expect(remote.videoTrack!.videoFormat).toBe(testVideoFormat);
    await manager.disconnect();
    await manager.connect(localStream);
    expect(stream.encoderConfigFormats).toEqual([updatedFormat, updatedFormat, updatedFormat]);
    await manager.close();
  });

  it("updates during generation without signals, restarts, state changes or altered interpolation size", async () => {
    const { manager, camera, stream } = makeManager(async () => true, true);
    const localStream = makeLocalStream(camera);
    const remote = await manager.connect(localStream);
    const starting = manager.startGeneration({ localStream, context: testContext });
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    stream.confirmationDeferreds[0]!.resolve();
    await starting;
    const state = manager.currentState;

    await manager.updateVideoFormat(updatedFormat);
    expect(manager.currentState).toBe(state);
    expect(stream.connectCalls).toHaveLength(1);
    expect(stream.beginCalls).toHaveLength(1);
    expect(stream.updateCalls).toHaveLength(0);
    expect(stream.stopGenerationCalls).toHaveLength(0);
    expect(stream.changeTargetSize).not.toHaveBeenCalled();

    // 后续更新生成条件与切换插帧仍使用原始生成尺寸。
    await manager.startGeneration({ localStream, context: new RealtimeContext({ prompt: "new prompt" }) });
    expect(stream.updateCalls[0]!.videoFormat).toBe(testVideoFormat);
    await manager.setFrameInterpolationEnabled(false);
    await manager.setFrameInterpolationEnabled(true);
    const view = { isMirrored: false, setMediaStream: vi.fn(), setFrameInterpolation: vi.fn() };
    VideoRenderRegistry.binding(remote.videoTrack!)!.attachHandler(view, VideoContentMode.fill);
    expect(view.setFrameInterpolation).toHaveBeenLastCalledWith(expect.objectContaining({ size: { width: 1280, height: 720 } }));
    await manager.close();
  });

  it("rejects invalid formats before calling RTC", async () => {
    const { manager, camera, stream } = makeManager();
    makeLocalStream(camera);
    await expect(manager.updateVideoFormat(new RealtimeVideoFormat({ width: 641, height: 360, fps: 20 })))
      .rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(stream.encoderConfigFormats).toHaveLength(0);
    expect(camera.currentTrack!.videoFormat).toBe(testVideoFormat);
  });

  it("keeps metadata and the connection on RTC failure and allows retry", async () => {
    const { manager, camera, stream } = makeManager();
    await manager.connect(makeLocalStream(camera));
    const state = manager.currentState;
    stream.failEncoderConfig = new XmaxError(XmaxErrorCode.rtcError, "encoder failure");
    await expect(manager.updateVideoFormat(updatedFormat)).rejects.toBe(stream.failEncoderConfig);
    expect(camera.currentTrack!.videoFormat).toBe(testVideoFormat);
    expect(manager.currentState).toBe(state);
    expect(stream.disconnectCalls).toBe(0);

    stream.failEncoderConfig = undefined;
    await manager.updateVideoFormat(updatedFormat);
    expect(camera.currentTrack!.videoFormat).toBe(updatedFormat);
    await manager.close();
  });

  it("rejects concurrent operations and commits metadata only after RTC succeeds", async () => {
    const { manager, camera, stream } = makeManager();
    const localStream = makeLocalStream(camera);
    const deferred = makeDeferred<void>();
    vi.spyOn(stream, "setVideoEncoderConfig").mockReturnValueOnce(deferred.promise);
    const updating = manager.updateVideoFormat(updatedFormat);
    expect(camera.currentTrack!.videoFormat).toBe(testVideoFormat);
    await expect(manager.updateVideoFormat(testVideoFormat)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    await expect(manager.connect(localStream)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    deferred.resolve();
    await updating;
    expect(camera.currentTrack!.videoFormat).toBe(updatedFormat);
    await manager.close();
  });

  it("rejects an update while connecting", async () => {
    const { manager, camera, stream } = makeManager();
    const deferred = makeDeferred<void>();
    vi.spyOn(stream, "setVideoEncoderConfig").mockReturnValueOnce(deferred.promise);
    const connecting = manager.connect(makeLocalStream(camera));
    await vi.waitFor(() => expect(stream.setVideoEncoderConfig).toHaveBeenCalledOnce());
    await expect(manager.updateVideoFormat(updatedFormat)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    deferred.resolve();
    await connecting;
    await manager.close();
  });

  it.each(["close", "disconnect"] as const)("does not commit a late update after %s", async (method) => {
    const { manager, camera, stream } = makeManager();
    const localStream = makeLocalStream(camera);
    await manager.connect(localStream);
    const deferred = makeDeferred<void>();
    vi.spyOn(stream, "setVideoEncoderConfig").mockReturnValueOnce(deferred.promise);
    const updating = manager.updateVideoFormat(updatedFormat);
    const rejected = expect(updating).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    const stopping = manager[method]();
    deferred.resolve();
    await Promise.all([rejected, stopping]);
    expect(localStream.videoTrack!.videoFormat).toBe(testVideoFormat);
    await manager.close();
  });

  it.each(["close", "stopLocalCameraStream"] as const)("clears the generation format when a new camera lifecycle starts after %s", async (method) => {
    const { manager, camera } = makeManager();
    makeLocalStream(camera);
    await manager.updateVideoFormat(updatedFormat);
    await manager[method]();
    const next = makeLocalStream(camera);
    next.videoTrack!.updateVideoFormat(updatedFormat);
    const remote = await manager.connect(next);
    expect(remote.videoTrack!.videoFormat).toBe(updatedFormat);
    await manager.close();
  });
});

describe("XmaxRealtimeManager frame interpolation", () => {
  async function generating(supports: () => Promise<boolean> = async () => true) {
    const s = makeManager(supports, true);
    const localStream = makeLocalStream(s.camera);
    const remote = await s.manager.connect(localStream);
    const pending = s.manager.startGeneration({ localStream, context: testContext });
    await vi.waitFor(() => expect(s.stream.beginCalls).toHaveLength(1));
    s.stream.confirmationDeferreds[0]!.resolve();
    await pending;
    let rendering: RemoteFrameInterpolationOptions | undefined;
    const view = {
      isMirrored: false, setMediaStream: vi.fn(),
      setFrameInterpolation: (options?: RemoteFrameInterpolationOptions) => { rendering = options; },
    };
    const binding = VideoRenderRegistry.binding(remote.videoTrack!)!;
    binding.attachHandler(view, VideoContentMode.fill);
    return { ...s, localStream, view, binding, rendering: () => rendering };
  }

  it("preserves original resolution and toggles locally without sending size signals or restarting generation", async () => {
    const s = await generating();
    expect(s.stream.beginCalls[0]!.videoFormat).toBe(testVideoFormat);
    expect(s.stream.beginCalls[0]!.targetSize).toBeUndefined();
    expect(s.rendering()!.size).toEqual({ width: 1280, height: 720 });
    expect(s.manager.isFrameInterpolationEnabled).toBe(true);
    const taskID = s.manager.currentState.taskID;
    await s.manager.setFrameInterpolationEnabled(false);
    expect(s.rendering()).toBeUndefined();
    expect(s.stream.changeTargetSize).not.toHaveBeenCalled();
    expect(s.manager.isFrameInterpolationEnabled).toBe(false);
    await s.manager.setFrameInterpolationEnabled(true);
    expect(s.manager.isFrameInterpolationEnabled).toBe(true);
    expect(s.rendering()!.size).toEqual({ width: 1280, height: 720 });
    expect(s.stream.changeTargetSize).not.toHaveBeenCalled();
    expect(s.stream.beginCalls).toHaveLength(1);
    expect(s.manager.currentState.taskID).toBe(taskID);
    await s.manager.close();
    expect(s.view.setMediaStream).toHaveBeenLastCalledWith(null);
    expect(s.rendering()).toBeUndefined();
  });

  it("keeps the feature enabled through view remounts without observing frame activity", async () => {
    const s = await generating();
    expect(s.rendering()!.onActiveChange).toBeUndefined();
    expect(s.manager.isFrameInterpolationEnabled).toBe(true);
    s.binding.detachHandler(s.view);
    expect(s.manager.isFrameInterpolationEnabled).toBe(true);
    s.binding.attachHandler(s.view, VideoContentMode.fill);
    expect(s.manager.isFrameInterpolationEnabled).toBe(true);
    await s.manager.close();
    expect(s.manager.isFrameInterpolationEnabled).toBe(true);
  });

  it("keeps the running task and render configuration intact when a capability check fails", async () => {
    let supported = true;
    const s = await generating(async () => supported);
    const initial = s.rendering()!;
    supported = false;
    await expect(s.manager.setFrameInterpolationEnabled(true)).rejects.toMatchObject({ code: XmaxErrorCode.frameInterpolationUnsupported });
    expect(s.rendering()).toBe(initial);
    expect(s.manager.isFrameInterpolationEnabled).toBe(true);
    expect(s.stream.disconnectCalls).toBe(0);
    expect(s.stream.changeTargetSize).not.toHaveBeenCalled();
    expect(s.manager.currentState.connectionState).toBe(RealtimeConnectionState.generating);
    await s.manager.close();
  });

  it("defaults to raw video on unsupported devices; explicit enable fails without interrupting generation", async () => {
    const s = await generating(async () => false);
    expect(s.manager.isFrameInterpolationEnabled).toBe(false);
    expect(s.stream.beginCalls[0]!.targetSize).toBeUndefined();
    expect(s.rendering()).toBeUndefined();
    await expect(s.manager.setFrameInterpolationEnabled(true)).rejects.toMatchObject({ code: XmaxErrorCode.frameInterpolationUnsupported });
    expect(s.manager.isFrameInterpolationEnabled).toBe(false);
    expect(s.stream.changeTargetSize).not.toHaveBeenCalled();
    expect(s.stream.disconnectCalls).toBe(0);
    await s.manager.close();
  });

  it("falls back locally on render failure without changing the return size, and ignores stale failures", async () => {
    const s = await generating();
    const initial = s.rendering()!;
    initial.onFailure(new Error("GPU lost"));
    expect(s.manager.isFrameInterpolationEnabled).toBe(false);
    expect(s.rendering()).toBeUndefined();
    expect(s.stream.changeTargetSize).not.toHaveBeenCalled();
    initial.onFailure(new Error("late"));
    expect(s.stream.changeTargetSize).not.toHaveBeenCalled();
    await s.manager.startGeneration({ localStream: s.localStream, context: testContext });
    expect(s.stream.updateCalls[0]!.targetSize).toBeUndefined();
    expect(s.stream.disconnectCalls).toBe(0);
    await s.manager.close();
  });

  it("does not publish a late capability result after a close", async () => {
    const pendingSupport = makeDeferred<boolean>();
    const s = makeManager(() => pendingSupport.promise, true);
    makeLocalStream(s.camera);
    const enabling = s.manager.setFrameInterpolationEnabled(true);
    const rejected = expect(enabling).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    const closing = s.manager.close();
    pendingSupport.resolve(true);
    await Promise.all([closing, rejected]);
    expect(s.manager.isFrameInterpolationEnabled).toBe(true); // cancelled operation preserves the feature setting
    expect(s.stream.changeTargetSize).not.toHaveBeenCalled();
  });

  it("does not change the return size when a GPU failure happens before generation confirmation", async () => {
    const s = makeManager(async () => true, true);
    const localStream = makeLocalStream(s.camera);
    const remote = await s.manager.connect(localStream);
    let rendering: RemoteFrameInterpolationOptions | undefined;
    VideoRenderRegistry.binding(remote.videoTrack!)!.attachHandler({
      isMirrored: false, setMediaStream: vi.fn(),
      setFrameInterpolation: (options) => { rendering = options; },
    }, VideoContentMode.fill);
    const pending = s.manager.startGeneration({ localStream, context: testContext });
    await vi.waitFor(() => expect(s.stream.beginCalls).toHaveLength(1));
    rendering!.onFailure(new Error("initial GPU failure"));
    expect(s.stream.changeTargetSize).not.toHaveBeenCalled();
    s.stream.confirmationDeferreds[0]!.resolve();
    await pending;
    expect(s.stream.changeTargetSize).not.toHaveBeenCalled();
    expect(s.manager.currentState.connectionState).toBe(RealtimeConnectionState.generating);
    expect(s.manager.isFrameInterpolationEnabled).toBe(false);
    await s.manager.close();
  });
});

describe("XmaxRealtimeManager network statistics", () => {
  it("replays immutable snapshots and clears on disconnect without accepting late updates", async () => {
    const { manager, camera, stream } = makeManager();
    const listener = vi.fn();
    const stats = { uplinkQuality: 1 as const, downlinkQuality: 2 as const, uplinkRttMs: 20, downlinkRttMs: 40 };
    await manager.setNetworkStatisticsListener(listener);
    expect(listener).toHaveBeenLastCalledWith(undefined);
    stream.networkStatisticsListener?.(stats);
    expect(listener).toHaveBeenCalledOnce();
    const localStream = makeLocalStream(camera);
    await manager.connect(localStream);
    stream.networkStatisticsListener?.(stats);
    expect(listener).toHaveBeenLastCalledWith(stats);
    expect(listener.mock.calls.at(-1)![0]).not.toBe(stats);
    expect(Object.isFrozen(listener.mock.calls.at(-1)![0])).toBe(true);
    const replay = vi.fn();
    await manager.setNetworkStatisticsListener(replay);
    expect(replay).toHaveBeenLastCalledWith(stats);
    stream.networkStatisticsListener?.(undefined);
    expect(replay).toHaveBeenLastCalledWith(undefined);
    stream.networkStatisticsListener?.(stats);
    const disconnecting = manager.disconnect();
    stream.networkStatisticsListener?.(stats);
    await disconnecting;
    expect(replay).toHaveBeenLastCalledWith(undefined);
    expect(replay).toHaveBeenCalledTimes(4);
    await manager.connect(localStream);
    await manager.setNetworkStatisticsListener(replay);
    expect(replay).toHaveBeenLastCalledWith(undefined);
    stream.networkStatisticsListener?.(stats);
    expect(replay).toHaveBeenLastCalledWith(stats);
    await manager.close();
    expect(replay).toHaveBeenLastCalledWith(undefined);
  });

  it.each([false, true])("isolates network observer failures and supports unsubscribe (async: %s)", async (asyncListener) => {
    const { manager, camera, stream } = makeManager();
    const fail = vi.fn(() => { throw new Error("observer failed"); });
    await manager.setNetworkStatisticsListener(asyncListener ? async () => fail() : fail);
    await manager.connect(makeLocalStream(camera));
    expect(() => stream.networkStatisticsListener?.({ uplinkQuality: 1 })).not.toThrow();
    expect(fail).toHaveBeenCalledTimes(2);
    await manager.setNetworkStatisticsListener();
    stream.networkStatisticsListener?.({ uplinkQuality: 2 });
    await manager.close();
    expect(fail).toHaveBeenCalledTimes(2);
  });
});

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

  it.each([80, 300, 2_000])("并行预热 %s ms 计入连接耗时，不重复叠加总耗时", async (validationMs) => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { manager, camera, session, stream } = makeManager();
    const snapshots: RealtimeLaunchTiming[] = [];
    await manager.setLaunchTimingListener((timing) => snapshots.push(timing));
    const originalCreate = camera.createLocalCameraStream.bind(camera);
    vi.spyOn(camera, "createLocalCameraStream").mockImplementation(async () => {
      now = 50;
      return originalCreate();
    });
    const sessionReady = makeDeferred<RealtimeSession>();
    const validationReady = makeDeferred<void>();
    const createSession = vi.spyOn(session, "createSession").mockReturnValue(sessionReady.promise);
    camera.waitForValidCameraFrame.mockReturnValue(validationReady.promise);
    const originalConnect = stream.connect.bind(stream);
    vi.spyOn(stream, "connect").mockImplementation(async (...args) => {
      await originalConnect(...args);
      now += 25; // 发布本地流的耗时，单独计时。
    });
    const localStream = await manager.createLocalCameraStream(cameraOptions);
    const pending = manager.startGeneration({ localStream, context: testContext });
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    if (validationMs < 150) {
      now = 50 + validationMs;
      validationReady.resolve();
      expect(snapshots.at(-1)?.connectionMs).toBeUndefined();
      now = 200;
      sessionReady.resolve(session.session);
      await vi.waitFor(() => expect(snapshots.at(-1)?.connectionMs).toBe(150));
    } else {
      now = 200;
      sessionReady.resolve(session.session);
      // 会话已就绪但预热未完成，发布屏障未放行，连接耗时尚未记录。
      await vi.waitFor(() => expect(stream.connectCalls).toHaveLength(1));
      expect(snapshots.at(-1)?.connectionMs).toBeUndefined();
      expect(stream.beginCalls).toHaveLength(0);
      now = 50 + validationMs;
      validationReady.resolve();
      await vi.waitFor(() => expect(snapshots.at(-1)?.connectionMs).toBe(validationMs));
    }
    await vi.waitFor(() => expect(snapshots.at(-1)?.publishMs).toBe(25));
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    stream.confirmationDeferreds[0]!.resolve();
    const remote = await pending;
    now += 100;
    VideoRenderRegistry.binding(remote.videoTrack!)!.frameDisplayHandler!();
    expect(snapshots.at(-1)).toEqual({
      cameraMs: 50, connectionMs: Math.max(150, validationMs), publishMs: 25, firstFrameMs: 100,
      totalMs: 50 + Math.max(150, validationMs) + 25 + 100,
    });
    await manager.close();
  });

  it("取消后的迟到预热结果不提交连接耗时", async () => {
    const { manager, camera, stream } = makeManager();
    const snapshots: RealtimeLaunchTiming[] = [];
    await manager.setLaunchTimingListener((timing) => snapshots.push(timing));
    const ready = makeDeferred<void>();
    camera.waitForValidCameraFrame.mockReturnValue(ready.promise);
    const localStream = await manager.createLocalCameraStream(cameraOptions);
    const pending = manager.connect(localStream);
    const rejected = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await vi.waitFor(() => expect(stream.connectCalls).toHaveLength(1));
    const closing = manager.close();
    ready.resolve();
    await closing;
    await rejected;
    expect(snapshots.at(-1)?.connectionMs).toBeUndefined();
  });

  it("系统弹出授权请求时统计用户授权耗时", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const cameraStatus = {
      state: "prompt" as string,
      onchange: null as (() => void) | null,
    };
    vi.stubGlobal("navigator", {
      permissions: { query: vi.fn(async () => cameraStatus) },
    });
    try {
      const { manager, camera } = makeManager();
      const snapshots: RealtimeLaunchTiming[] = [];
      await manager.setLaunchTimingListener((timing) => snapshots.push(timing));
      const originalCreate = camera.createLocalCameraStream.bind(camera);
      vi.spyOn(camera, "createLocalCameraStream").mockImplementation(async (options) => {
        // 用户在系统弹窗上停留 800ms 后点击允许；不触发 onchange，
        // 模拟 Safari 只能靠重新查询发现授权决定。
        now = 800;
        cameraStatus.state = "granted";
        return originalCreate(options);
      });

      await manager.createLocalCameraStream(cameraOptions);
      expect(snapshots.at(-1)?.cameraMs).toBe(800);
      await vi.waitFor(() => expect(snapshots.at(-1)?.permissionMs).toBe(800));
      await manager.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("浏览器已授权时授权耗时立即完成", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(async () => ({ state: "granted", onchange: null })),
      },
    });
    try {
      const { manager } = makeManager();
      const snapshots: RealtimeLaunchTiming[] = [];
      await manager.setLaunchTimingListener((timing) => snapshots.push(timing));
      await manager.createLocalCameraStream(cameraOptions);
      expect(snapshots.at(-1)?.cameraMs).toEqual(expect.any(Number));
      expect(snapshots.at(-1)?.permissionMs).toEqual(expect.any(Number));
      await manager.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("分阶段回调：连接包含会话、编码、进房和预热等待", async () => {
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
    vi.spyOn(stream, "connect").mockImplementation(async (_connection, _audio, ensureActive, beforePublish) => {
      now += 350;
      await beforePublish?.();
      ensureActive();
    });

    const localStream = await manager.createLocalCameraStream(cameraOptions);
    const pending = manager.startGeneration({ localStream, context: testContext });
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    stream.confirmationDeferreds[0]!.resolve();
    const remote = await pending;

    // 即使没有挂载视图，生成仍能返回；此时不能伪报首帧和总耗时。
    expect(snapshots).toEqual([
      {}, {}, { cameraMs: 250 }, { cameraMs: 250, connectionMs: 500 },
      { cameraMs: 250, connectionMs: 500, publishMs: 0 },
    ]);
    const onFrame = VideoRenderRegistry.binding(remote.videoTrack!)!.frameDisplayHandler!;
    now = 1250;
    onFrame();
    expect(snapshots.at(-1)).toEqual({ cameraMs: 250, connectionMs: 500, publishMs: 0, firstFrameMs: 400, totalMs: 1150 });
    expect(Object.isFrozen(snapshots.at(-1))).toBe(true);

    now = 1500;
    onFrame();
    await manager.startGeneration({ localStream, context: new RealtimeContext({ prompt: "updated" }) });
    expect(snapshots).toHaveLength(6);
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
    expect(listener.mock.calls.at(-1)![0]).toEqual({ cameraMs: expect.any(Number), connectionMs: expect.any(Number), publishMs: expect.any(Number) });
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
  it.each([undefined, true, false])("相机预热开关 %s 控制生成和重连，禁用时预热不参与连接", async (enableFrameValidation) => {
    const { manager, camera, stream } = makeManager();
    const snapshots: RealtimeLaunchTiming[] = [];
    await manager.setLaunchTimingListener((timing) => snapshots.push(timing));
    const create = vi.spyOn(camera, "createLocalCameraStream");
    const options = {
      videoFormat: testVideoFormat, position: CameraPosition.front, useMicrophone: false,
      enableFrameValidation,
    };
    const localStream = await manager.createLocalCameraStream(options);
    expect(create).toHaveBeenCalledWith(options);
    const pending = manager.startGeneration({ localStream, context: testContext });
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    stream.confirmationDeferreds[0]!.resolve();
    await pending;
    if (enableFrameValidation === false) {
      expect(camera.waitForValidCameraFrame).not.toHaveBeenCalled();
    } else {
      expect(camera.waitForValidCameraFrame).toHaveBeenCalledOnce();
    }
    expect(snapshots.at(-1)?.connectionMs).toEqual(expect.any(Number));
    await manager.disconnect();
    await manager.connect(localStream);
    expect(camera.waitForValidCameraFrame).toHaveBeenCalledTimes(enableFrameValidation === false ? 0 : 2);
    await manager.close();
  });

  it("亮度检查超时降级完成后继续生成，不关闭会话或重开相机", async () => {
    vi.useFakeTimers();
    try {
      const { manager, camera, stream, session } = makeManager();
      camera.waitForValidCameraFrame.mockImplementation(() =>
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      );
      const pending = manager.startGeneration({ localStream: makeLocalStream(camera), context: testContext });
      await vi.advanceTimersByTimeAsync(0);
      expect(stream.connectCalls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(stream.beginCalls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(stream.beginCalls).toHaveLength(1);
      expect(session.closedSessionIDs).toHaveLength(0);
      expect(camera.stopCalls).toBe(0);
      stream.confirmationDeferreds[0]!.resolve();
      await pending;
      expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.generating);
      await manager.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("曝光与会话进房并行，但未就绪时不开始生成", async () => {
    const { manager, camera, stream, session } = makeManager();
    const ready = makeDeferred<void>();
    camera.waitForValidCameraFrame.mockImplementation(() => ready.promise);
    const pending = manager.startGeneration({ localStream: makeLocalStream(camera), context: testContext });
    await vi.waitFor(() => expect(stream.connectCalls).toHaveLength(1));
    expect(session.createCalls).toBe(1);
    expect(stream.beginCalls).toHaveLength(0);
    expect(session.heartbeatSessionID).toBeUndefined();
    ready.resolve();
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    stream.confirmationDeferreds[0]!.resolve();
    await pending;
    await manager.close();
  });

  it("采样失败清理连接而保留相机，重试重新检查", async () => {
    const { manager, camera, stream, session } = makeManager();
    const local = makeLocalStream(camera);
    camera.waitForValidCameraFrame.mockRejectedValueOnce(
      new XmaxError(XmaxErrorCode.mediaError, "sampling failed"),
    );
    await expect(manager.startGeneration({ localStream: local, context: testContext }))
      .rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    expect(stream.beginCalls).toHaveLength(0);
    expect(session.closedSessionIDs).toEqual(["session-1"]);
    expect(camera.stopCalls).toBe(0);
    await manager.connect(local);
    expect(camera.waitForValidCameraFrame).toHaveBeenCalledTimes(2);
    await manager.close();
  });

  it("关闭立即取消曝光等待，不发送生成信令", async () => {
    const { manager, camera, stream } = makeManager();
    camera.waitForValidCameraFrame.mockImplementation((signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new XmaxError(XmaxErrorCode.cancelled, "cancelled")));
    }));
    const pending = manager.startGeneration({ localStream: makeLocalStream(camera), context: testContext });
    const rejected = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await vi.waitFor(() => expect(stream.connectCalls).toHaveLength(1));
    await manager.close();
    await rejected;
    expect(camera.waitForValidCameraFrame.mock.calls[0]![0].aborted).toBe(true);
    expect(stream.beginCalls).toHaveLength(0);
  });

  it("会话失败取消仍在运行的曝光检查", async () => {
    const { manager, camera, session } = makeManager();
    session.failCreate = new XmaxError(XmaxErrorCode.networkError, "offline");
    camera.waitForValidCameraFrame.mockImplementation((signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new XmaxError(XmaxErrorCode.cancelled, "cancelled")));
    }));
    await expect(manager.connect(makeLocalStream(camera))).rejects.toMatchObject({ code: XmaxErrorCode.networkError });
    expect(camera.waitForValidCameraFrame.mock.calls[0]![0].aborted).toBe(true);
    await manager.close();
  });

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
      new RealtimeConfiguration({ model: RealtimeModel.x2_0_trtc }),
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
          provider: RtcProvider.trtc,
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
          provider: RtcProvider.trtc,
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

  it("生成后断开：由生成管理器停止任务，再清理连接并保留预览", async () => {
    const { manager, camera, stream, session } = makeManager(async () => false);
    const localStream = makeLocalStream(camera);
    const pending = manager.startGeneration({ localStream, context: testContext });
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    stream.confirmationDeferreds[0]!.resolve();
    await pending;
    const taskID = manager.currentState.taskID;
    const stop = vi.spyOn(stream, "stopGeneration");
    const disconnect = vi.spyOn(stream, "disconnect");

    await manager.disconnect();

    expect(stream.stopGenerationCalls).toEqual([taskID]);
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(disconnect.mock.invocationCallOrder[0]!);
    expect(session.closedSessionIDs).toEqual(["session-1"]);
    expect(camera.stopCalls).toBe(0);
    expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.ready);
  });

  it("等待远端轨就绪时断开：立即取消等待，只停止一次任务", async () => {
    const { manager, camera, stream } = makeManager(async () => false);
    const localStream = makeLocalStream(camera);
    const remote = await manager.connect(localStream);
    const mediaTrack = Object.assign(new EventTarget(), { muted: true }) as MediaStreamTrack;
    remote.videoTrack!.mediaStreamTrack = mediaTrack;
    const listen = vi.spyOn(mediaTrack, "addEventListener");
    const remove = vi.spyOn(mediaTrack, "removeEventListener");
    const pending = manager.startGeneration({ localStream, context: testContext });
    const rejected = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await vi.waitFor(() => expect(stream.beginCalls).toHaveLength(1));
    stream.confirmationDeferreds[0]!.resolve();
    await vi.waitFor(() => expect(listen).toHaveBeenCalledWith("unmute", expect.any(Function)));

    await manager.disconnect();
    await rejected;

    expect(remove).toHaveBeenCalledWith("unmute", expect.any(Function));
    expect(stream.stopGenerationCalls).toEqual([stream.beginCalls[0]!.taskID]);
    expect(stream.activateAudioCalls).toBe(0);
    expect(manager.currentState.connectionState).toBe(RealtimeConnectionState.ready);
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
