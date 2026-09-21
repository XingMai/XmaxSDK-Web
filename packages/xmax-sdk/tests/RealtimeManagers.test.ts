import { afterEach, describe, expect, it, vi } from "vitest";
import { XmaxRealtimeConnectionManager } from "../src/Core/Realtime/XmaxRealtimeConnectionManager";
import { XmaxRealtimeGenerationManager } from "../src/Core/Realtime/XmaxRealtimeGenerationManager";
import { RealtimeCoordinator } from "../src/Core/Realtime/RealtimeCoordinator";
import { RealtimeLaunchTimer } from "../src/Core/Realtime/RealtimeLaunchTimer";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { RemoteStream } from "../src/Foundation/RTC/RemoteStream";
import { RealtimeContext } from "../src/Service/Realtime/RealtimeContext";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { RealtimeSession } from "../src/Service/Realtime/RealtimeSession";
import { RealtimeSessionConnection } from "../src/Service/Realtime/RealtimeSessionConnection";
import type { RealtimeSessionHeartbeatHandlers } from "../src/Service/Realtime/RealtimeSessionServicing";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../src/Service/Realtime/RealtimeVideoTrack";
import { VideoRenderRegistry } from "../src/Service/Realtime/VideoRenderBinding";
import { VideoContentMode } from "../src/Foundation/Media/Video/VideoContentMode";
import type { StreamControlling, StreamGenerationOptions } from "../src/Stream/StreamControlling";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function operation() {
  const abort = new AbortController();
  return {
    abort,
    signal: abort.signal,
    ensureCurrent: () => { if (abort.signal.aborted) throw RealtimeCoordinator.cancelledError(); },
  };
}

const videoFormat = new RealtimeVideoFormat({ width: 1280, height: 720, fps: 30 });
const context = new RealtimeContext({ prompt: "first" });

function makeStream() {
  const methods = {
    beginGeneration: vi.fn((_options: StreamGenerationOptions) => Promise.resolve()),
    updateGeneration: vi.fn((_options: StreamGenerationOptions) => {}),
    stopGeneration: vi.fn(async (_id: string) => {}),
    activateRemoteAudio: vi.fn(async () => {}),
    setVideoEncoderConfig: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    setRemoteAudioVolume: vi.fn(),
  };
  // 两个内部 Manager 只使用上述传输方法，其他传输能力由主 Manager 的集成测试覆盖。
  return { methods, controller: methods as unknown as StreamControlling };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("XmaxRealtimeGenerationManager", () => {
  function setup() {
    const { methods: stream, controller } = makeStream();
    const manager = new XmaxRealtimeGenerationManager(controller, () => "task-test?os=web");
    const op = operation();
    const options = { ...op, videoFormat, context, waitUntilRemoteReady: vi.fn(async () => {}) };
    return { manager, stream, options, op };
  }

  it("owns context updates and stops its active task on reset without a coordinator task ID", async () => {
    const { manager, stream, options } = setup();
    expect(() => manager.validateContext()).toThrow("first generation");
    const taskID = await manager.start(options);
    expect(manager.validateContext()).toBe(context);
    const updated = new RealtimeContext({ prompt: "updated" });
    manager.update(taskID, { videoFormat, context: updated });
    expect(manager.validateContext()).toBe(updated);
    expect(stream.beginGeneration).toHaveBeenCalledOnce();
    expect(stream.updateGeneration).toHaveBeenCalledWith({ taskID, videoFormat, targetSize: undefined, context: updated });
    await manager.reset();
    await manager.reset();
    expect(stream.stopGeneration).toHaveBeenCalledOnce();
    expect(stream.stopGeneration).toHaveBeenCalledWith(taskID);
    expect(() => manager.validateContext()).toThrow("first generation");
  });

  it("shares an in-flight stop between cancellation and reset", async () => {
    const { manager, stream, options } = setup();
    const taskID = await manager.start(options);
    const stopped = deferred<void>();
    stream.stopGeneration.mockReturnValue(stopped.promise);
    const stopping = manager.stop(taskID);
    let resetCompleted = false;
    const resetting = manager.reset(taskID).then(() => { resetCompleted = true; });
    await Promise.resolve();
    expect(resetCompleted).toBe(false);
    expect(stream.stopGeneration).toHaveBeenCalledOnce();
    stopped.resolve();
    await Promise.all([stopping, resetting]);
    await manager.stop(taskID);
    expect(stream.stopGeneration).toHaveBeenCalledOnce();
  });

  it("waits for confirmation and remote readiness before activating audio", async () => {
    const { manager, stream, options } = setup();
    const confirmed = deferred<void>(), ready = deferred<void>();
    stream.beginGeneration.mockReturnValue(confirmed.promise);
    options.waitUntilRemoteReady.mockReturnValue(ready.promise);
    const pending = manager.start(options);
    expect(options.waitUntilRemoteReady).not.toHaveBeenCalled();
    confirmed.resolve();
    await vi.waitFor(() => expect(options.waitUntilRemoteReady).toHaveBeenCalledOnce());
    expect(stream.activateRemoteAudio).not.toHaveBeenCalled();
    ready.resolve();
    await pending;
    expect(stream.activateRemoteAudio).toHaveBeenCalledOnce();
    await manager.reset();
  });

  it.each(["resolve", "reject"] as const)("cancels confirmation and ignores its late %s", async (outcome) => {
    const { manager, stream, options, op } = setup();
    const confirmed = deferred<void>();
    const removed = vi.spyOn(op.signal, "removeEventListener");
    stream.beginGeneration.mockReturnValue(confirmed.promise);
    const pending = manager.start(options);
    const rejected = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    op.abort.abort();
    await rejected;
    if (outcome === "resolve") confirmed.resolve();
    else confirmed.reject(new Error("late error"));
    await Promise.resolve();
    expect(stream.activateRemoteAudio).not.toHaveBeenCalled();
    expect(options.waitUntilRemoteReady).not.toHaveBeenCalled();
    expect(stream.stopGeneration).toHaveBeenCalledOnce();
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    await manager.reset();
    expect(stream.stopGeneration).toHaveBeenCalledOnce();
  });

  it("retains the previous context when update signalling fails", async () => {
    const { manager, stream, options } = setup();
    const taskID = await manager.start(options);
    stream.updateGeneration.mockImplementation(() => { throw new Error("update failed"); });
    expect(() => manager.update(taskID, { videoFormat, context: new RealtimeContext({ prompt: "bad" }) })).toThrow("update failed");
    expect(manager.validateContext()).toBe(context);
    expect(stream.stopGeneration).not.toHaveBeenCalled();
    await manager.reset();
  });

  it("stops a task on synchronous begin failure without replacing the original error", async () => {
    const { manager, stream, options } = setup();
    stream.beginGeneration.mockImplementation(() => { throw new Error("begin failed"); });
    stream.stopGeneration.mockRejectedValue(new Error("stop failed"));
    await expect(manager.start(options)).rejects.toThrow("begin failed");
    expect(stream.stopGeneration).toHaveBeenCalledOnce();
    await manager.reset();
    expect(() => manager.validateContext()).toThrow();
  });

  it("keeps the web task ID wire format", async () => {
    const { controller } = makeStream();
    const manager = new XmaxRealtimeGenerationManager(controller);
    const id = await manager.start({ ...operation(), videoFormat, context, waitUntilRemoteReady: async () => {} });
    expect(id).toMatch(/^task-[A-Za-z0-9_-]{22}\?os=web$/);
    await manager.reset();
  });
});

describe("XmaxRealtimeConnectionManager", () => {
  function setup() {
    const { methods: stream, controller } = makeStream();
    const connection = new RealtimeSessionConnection({ provider: "trtc", roomID: "room", sdkAppID: "1", userID: "user", userSig: "sig", privateMapKey: "key" });
    const session = new RealtimeSession({ id: "session", connection });
    const service = {
      createSession: vi.fn(async () => session), closeSession: vi.fn(async (_id: string) => {}),
      startHeartbeat: vi.fn((_id: string, _handlers: RealtimeSessionHeartbeatHandlers) => {}),
      stopHeartbeat: vi.fn(),
    };
    const events = { onHeartbeatFailure: vi.fn(), onFrameDisplayed: vi.fn(), onRenderAttached: vi.fn(), onRenderDetached: vi.fn() };
    const manager = new XmaxRealtimeConnectionManager({
      sessionService: service, streamController: controller, timing: new RealtimeLaunchTimer(),
      isMirrored: () => true, remoteAudioVolume: () => 0.25, ...events,
    });
    const op = operation();
    const options = {
      localTrack: new RealtimeVideoTrack({ id: "local", videoFormat }), model: RealtimeModel.x2_fast_1080p,
      includeLocalAudio: true, ensureCurrent: op.ensureCurrent, onPublished: vi.fn(),
    };
    return { manager, stream, service, events, options, op, session, connection };
  }

  it("owns session and track resources and registers rendering without starting generation", async () => {
    const { manager, stream, service, events, options } = setup();
    const remote = await manager.connect(options);
    expect(manager.currentSessionID).toBe("session");
    expect(options.onPublished).toHaveBeenCalledOnce();
    expect(stream.setVideoEncoderConfig.mock.invocationCallOrder[0]).toBeLessThan(stream.connect.mock.invocationCallOrder[0]!);
    expect(stream.setRemoteAudioVolume).toHaveBeenCalledWith(0.25);
    expect(stream.beginGeneration).not.toHaveBeenCalled();
    const track = remote.videoTrack!;
    const binding = VideoRenderRegistry.binding(track)!;
    const view = { isMirrored: false, setMediaStream: vi.fn(), setFrameInterpolation: vi.fn() };
    binding.attachHandler(view, VideoContentMode.fit);
    expect(view.isMirrored).toBe(true);
    expect(events.onRenderAttached).toHaveBeenCalledOnce();
    binding.frameDisplayHandler?.();
    expect(events.onFrameDisplayed).toHaveBeenCalledOnce();
    await manager.disconnect();
    expect(manager.currentSessionID).toBeUndefined();
    expect(VideoRenderRegistry.binding(track)).toBeUndefined();
    expect(service.closeSession).toHaveBeenCalledWith("session");
    expect(() => manager.makeRemoteStream()).toThrow("unavailable");
    binding.frameDisplayHandler?.();
    expect(events.onFrameDisplayed).toHaveBeenCalledOnce();
  });

  it("retains a just-created session for cleanup if cancellation arrives during creation", async () => {
    const { manager, stream, service, options, op, session } = setup();
    const created = deferred<RealtimeSession>();
    service.createSession.mockReturnValue(created.promise);
    const pending = manager.connect(options);
    op.abort.abort();
    created.resolve(session);
    await expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(stream.setVideoEncoderConfig).not.toHaveBeenCalled();
    expect(stream.connect).not.toHaveBeenCalled();
    await manager.disconnect();
    expect(service.closeSession).toHaveBeenCalledOnce();
    expect(service.closeSession).toHaveBeenCalledWith("session");
  });

  it("closes the session and unregisters the remote track even if leaving RTC fails", async () => {
    const { manager, stream, service, options } = setup();
    const remote = await manager.connect(options);
    stream.disconnect.mockRejectedValue(new Error("leave failed"));
    expect(await manager.disconnect()).toBe("session");
    expect(service.closeSession).toHaveBeenCalledOnce();
    expect(VideoRenderRegistry.binding(remote.videoTrack!)).toBeUndefined();
  });

  it("accepts credential refresh, rejects room rebinding and ignores refresh after teardown", async () => {
    const { manager, service, events, options } = setup();
    await manager.connect(options);
    const handlers = service.startHeartbeat.mock.calls[0]![1];
    const refresh = (roomID: string) => new RealtimeSession({ id: "session", connection: new RealtimeSessionConnection({
      provider: "trtc", roomID, sdkAppID: "1", userID: "user", userSig: "new-sig", privateMapKey: "key",
    }) });
    handlers.onRefresh?.(refresh("room"));
    expect(events.onHeartbeatFailure).not.toHaveBeenCalled();
    handlers.onRefresh?.(refresh("other-room"));
    expect(events.onHeartbeatFailure).toHaveBeenCalledWith("session", expect.objectContaining({ code: XmaxErrorCode.sessionError }));
    await manager.disconnect();
    handlers.onRefresh?.(refresh("yet-another-room"));
    expect(events.onHeartbeatFailure).toHaveBeenCalledOnce();
  });

  it.each(["abort", "unmute", "timeout"])("cleans up remote readiness listeners on %s", async (outcome) => {
    vi.useFakeTimers();
    const { manager, options, op } = setup();
    await manager.connect(options);
    const media = Object.assign(new EventTarget(), { muted: true }) as MediaStreamTrack;
    const removed = vi.spyOn(media, "removeEventListener");
    manager.handleRemoteStreamBinding({ stream: new RemoteStream({ roomID: "room", userID: "bot" }), videoTrack: media });
    const pending = manager.waitUntilRemoteTrackReady(5000, op.signal);
    if (outcome === "abort") {
      const rejected = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
      op.abort.abort();
      await rejected;
    } else {
      if (outcome === "unmute") media.dispatchEvent(new Event("unmute"));
      else await vi.advanceTimersByTimeAsync(5000);
      await pending;
    }
    expect(removed).toHaveBeenCalledWith("unmute", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    await manager.disconnect();
  });
});
