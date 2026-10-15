import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingController } from "../src/Media/Recording/RecordingController";
import {
  RealtimeRecordingEventType as EventType,
  RealtimeRecordingFinishReason as Reason,
  type RealtimeRecordingEvent,
} from "../src/Service/Realtime/RealtimeRecordingEvent";
import type { RecordingTracks } from "../src/Foundation/Media/Recording/RecordingTracks";

const processRecording = vi.hoisted(() => vi.fn(async (blob: Blob) => blob));
vi.mock("../src/Media/Recording/RecordingProcessor", () => ({
  RecordingProcessor: class { process = processRecording; },
}));

class Track {
  readyState = "live";
  muted = false;
  enabled = true;
  stop = vi.fn(() => { this.readyState = "ended"; });
  constructor(readonly kind: string) {}
}

class Stream {
  constructor(private readonly tracks: Track[]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
}

class AudioContextStub {
  static instances: AudioContextStub[] = [];
  static suspended = false;
  static pending = false;
  state = "running";
  destinationTrack = new Track("audio");
  silence = { offset: { value: 1 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
  sources: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  resume = vi.fn(async () => {
    if (AudioContextStub.pending) await new Promise(() => {});
  });
  close = vi.fn(async () => { this.state = "closed"; });
  constructor() {
    if (AudioContextStub.suspended) this.state = "suspended";
    AudioContextStub.instances.push(this);
  }
  createMediaStreamDestination() { return { stream: new Stream([this.destinationTrack]) }; }
  createConstantSource() { return this.silence; }
  createMediaStreamSource() {
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    this.sources.push(source);
    return source;
  }
}

class Recorder {
  static instances: Recorder[] = [];
  static supported = true;
  static isTypeSupported = () => Recorder.supported;
  state = "inactive";
  mimeType: string;
  ondataavailable?: ((event: { data: Blob }) => void) | null;
  onstop?: (() => void) | null;
  onerror?: (() => void) | null;
  stopCalls = 0;
  constructor(readonly stream: Stream, options: { mimeType: string }) {
    this.mimeType = options.mimeType;
    Recorder.instances.push(this);
  }
  start() { this.state = "recording"; }
  stop() { this.stopCalls++; this.state = "inactive"; }
  data(text = "encoded-video") { this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) }); }
  async finalize() {
    this.data();
    this.onstop?.();
    await vi.advanceTimersByTimeAsync(0);
  }
}

function setup() {
  const events: RealtimeRecordingEvent[] = [];
  const controller = new RecordingController();
  controller.setListener(event => events.push(event));
  const videoTrack = new Track("video");
  const audioTrack = new Track("audio");
  let tracks = { videoTrack, audioTrack } as unknown as RecordingTracks | undefined;
  const readTracks = vi.fn(() => tracks);
  const videos: Array<ReturnType<typeof makeVideo>> = [];
  function makeVideo() {
    return {
      readyState: 4,
      muted: false,
      playsInline: false,
      srcObject: undefined as unknown,
      callback: undefined as (() => void) | undefined,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
      requestVideoFrameCallback(callback: () => void) { this.callback = callback; return 1; },
      cancelVideoFrameCallback: vi.fn(),
    };
  }
  vi.stubGlobal("document", { createElement: () => {
    const video = makeVideo();
    videos.push(video);
    return video;
  } });
  return {
    controller, events, videos, readTracks, videoTrack, audioTrack,
    setTracks: (value: RecordingTracks | undefined) => { tracks = value; },
    async start(taskID = "task-1") {
      controller.start(taskID, readTracks);
      await Promise.resolve();
      await Promise.resolve();
      videos.at(-1)?.callback?.();
      await Promise.resolve();
      return Recorder.instances.at(-1)!;
    },
  };
}

describe("RecordingController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Recorder.instances = [];
    Recorder.supported = true;
    AudioContextStub.instances = [];
    AudioContextStub.suspended = false;
    AudioContextStub.pending = false;
    processRecording.mockReset().mockImplementation(async blob => blob);
    vi.stubGlobal("MediaRecorder", Recorder);
    vi.stubGlobal("AudioContext", AudioContextStub);
    vi.stubGlobal("MediaStream", Stream);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("allocates nothing until explicitly started", () => {
    setup();
    expect(Recorder.instances).toHaveLength(0);
    expect(AudioContextStub.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times 20 seconds from the first frame and waits for final data before delivering once", async () => {
    const s = setup();
    s.controller.start("task-1", s.readTracks);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(Recorder.instances).toHaveLength(0);
    s.videos[0]!.callback?.();
    const recorder = Recorder.instances[0]!;
    recorder.data("first");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(recorder.stopCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(recorder.stopCalls).toBe(1);
    expect(s.events).toHaveLength(0);
    await recorder.finalize();
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ type: EventType.completed, taskID: "task-1", result: { hasAudio: true, reason: Reason.durationLimit } });
    const event = s.events[0]!;
    if (event.type !== EventType.failed) {
      expect(await event.result.blob.text()).toBe("firstencoded-video");
      expect(event.result.blob.type).toBe(recorder.mimeType.toLowerCase());
    }
    await s.controller.stop(Reason.generationEnded);
    expect(s.events).toHaveLength(1);
    expect(s.videoTrack.stop).not.toHaveBeenCalled();
    expect(s.audioTrack.stop).not.toHaveBeenCalled();
    expect(AudioContextStub.instances[0]!.destinationTrack.stop).toHaveBeenCalledOnce();
    expect(AudioContextStub.instances[0]!.close).toHaveBeenCalledOnce();
    expect(AudioContextStub.instances[0]!.silence.offset.value).toBe(0);
    expect(AudioContextStub.instances[0]!.silence.start).toHaveBeenCalledOnce();
    expect(AudioContextStub.instances[0]!.silence.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([Reason.generationEnded, Reason.restarted, Reason.mediaInterrupted])("delivers a finalized interrupted file for %s", async reason => {
    const s = setup();
    const recorder = await s.start();
    const stopped = s.controller.stop(reason);
    const again = s.controller.stop(reason);
    expect(stopped).toBe(again);
    expect(recorder.stopCalls).toBe(1);
    await recorder.finalize();
    await stopped;
    expect(s.events[0]).toMatchObject({ type: EventType.interrupted, result: { reason } });
  });

  it("keeps the recorder track set fixed when audio arrives late or is replaced", async () => {
    const s = setup();
    s.setTracks({ videoTrack: s.videoTrack as unknown as MediaStreamTrack });
    const recorder = await s.start();
    const original = recorder.stream.getTracks();
    expect(original).toHaveLength(2);
    expect(AudioContextStub.instances[0]!.sources).toHaveLength(0);
    s.setTracks({ videoTrack: s.videoTrack, audioTrack: s.audioTrack } as unknown as RecordingTracks);
    await vi.advanceTimersByTimeAsync(100);
    const context = AudioContextStub.instances[0]!;
    expect(context.sources).toHaveLength(1);
    s.setTracks({ videoTrack: s.videoTrack, audioTrack: new Track("audio") } as unknown as RecordingTracks);
    await vi.advanceTimersByTimeAsync(100);
    expect(context.sources[0]!.disconnect).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(2);
    expect(recorder.stream.getTracks()).toEqual(original);
    const stopped = s.controller.stop(Reason.generationEnded);
    await recorder.finalize();
    await stopped;
    expect(s.events[0]).toMatchObject({ result: { hasAudio: true } });
  });

  it("reports missing audio accurately without delaying video", async () => {
    const s = setup();
    s.setTracks({ videoTrack: s.videoTrack as unknown as MediaStreamTrack });
    const recorder = await s.start();
    const stopped = s.controller.stop(Reason.generationEnded);
    await recorder.finalize();
    await stopped;
    expect(s.events[0]).toMatchObject({ type: EventType.interrupted, result: { hasAudio: false } });
  });

  it.each(["missing", "replaced", "ended"])("interrupts when video is %s", async kind => {
    const s = setup();
    const recorder = await s.start();
    if (kind === "missing") s.setTracks(undefined);
    if (kind === "replaced") s.setTracks({ videoTrack: new Track("video") } as unknown as RecordingTracks);
    if (kind === "ended") s.videoTrack.readyState = "ended";
    await vi.advanceTimersByTimeAsync(100);
    expect(recorder.stopCalls).toBe(1);
    await recorder.finalize();
    expect(s.events[0]).toMatchObject({ type: EventType.interrupted, result: { reason: Reason.mediaInterrupted } });
  });

  it("treats an unsolicited native stop as interruption, not 20-second completion", async () => {
    const s = setup();
    const recorder = await s.start();
    recorder.state = "inactive";
    await recorder.finalize();
    expect(s.events[0]).toMatchObject({ type: EventType.interrupted });
  });

  it("isolates task IDs while an older recording finalizes", async () => {
    const s = setup();
    const first = await s.start("first");
    const second = await s.start("second");
    expect(first.stopCalls).toBe(1);
    await first.finalize();
    const stopped = s.controller.stop(Reason.generationEnded);
    await second.finalize();
    await stopped;
    expect(s.events.map(event => event.taskID)).toEqual(["first", "second"]);
    expect(AudioContextStub.instances.every(context => context.close.mock.calls.length === 1)).toBe(true);
  });

  it("reports encoder errors as failed, even when earlier chunks are nonempty", async () => {
    const s = setup();
    const recorder = await s.start();
    recorder.data();
    recorder.onerror?.();
    await recorder.finalize();
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ type: EventType.failed });
    expect(s.events[0]).not.toHaveProperty("result");
  });

  it("fails empty recordings instead of returning an unusable blob", async () => {
    const s = setup();
    const recorder = await s.start();
    const stopped = s.controller.stop(Reason.generationEnded);
    recorder.onstop?.();
    await stopped;
    expect(s.events[0]).toMatchObject({ type: EventType.failed });
  });

  it("bounds finalization and detaches late events", async () => {
    const s = setup();
    const recorder = await s.start();
    const stopped = s.controller.stop(Reason.generationEnded);
    await vi.advanceTimersByTimeAsync(5_000);
    await stopped;
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ type: EventType.failed });
    await recorder.finalize();
    expect(s.events).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails if the browser cannot enable recording audio", async () => {
    AudioContextStub.suspended = true;
    const s = setup();
    await s.start();
    expect(s.events[0]).toMatchObject({ type: EventType.failed });
    expect(Recorder.instances).toHaveLength(0);
    expect(AudioContextStub.instances[0]!.close).toHaveBeenCalledOnce();
  });

  it("bounds pending audio activation and first frame waits", async () => {
    AudioContextStub.pending = true;
    const s = setup();
    s.controller.start("task", s.readTracks);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.events[0]).toMatchObject({ type: EventType.failed });
    expect(AudioContextStub.instances[0]!.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can cancel preparation without starting the recorder later", async () => {
    const s = setup();
    s.controller.start("task", s.readTracks);
    await s.controller.stop(Reason.generationEnded);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(Recorder.instances).toHaveLength(0);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]!.type).toBe(EventType.failed);
  });

  it("does not propagate source access or listener failures", async () => {
    const s = setup();
    s.controller.setListener(() => { throw new Error("consumer"); });
    expect(() => s.controller.start("task", () => { throw new Error("source"); })).not.toThrow();
    s.controller.setListener(async () => { throw new Error("async consumer"); });
    s.controller.start("task", () => undefined);
    await Promise.resolve();
  });

  it("clearing the listener does not stop an active recording", async () => {
    const s = setup();
    const recorder = await s.start();
    s.controller.setListener(undefined);
    expect(recorder.stopCalls).toBe(0);
    const stopped = s.controller.stop(Reason.generationEnded);
    await recorder.finalize();
    await stopped;
    expect(s.events).toHaveLength(0);
  });

  it("rejects unavailable recording APIs without touching source tracks", () => {
    const s = setup();
    vi.stubGlobal("MediaRecorder", undefined);
    s.controller.start("task", s.readTracks);
    expect(s.events[0]).toMatchObject({ type: EventType.failed });
    expect(s.videoTrack.stop).not.toHaveBeenCalled();
  });

  it("rejects unsupported formats and releases preparation resources", async () => {
    Recorder.supported = false;
    const s = setup();
    await s.start();
    expect(s.events[0]).toMatchObject({ type: EventType.failed });
    expect(AudioContextStub.instances[0]!.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enforces the buffer memory cap", async () => {
    const s = setup();
    const recorder = await s.start();
    recorder.ondataavailable?.({ data: { size: 65 * 1024 * 1024 } as Blob });
    await recorder.finalize();
    expect(s.events[0]).toMatchObject({ type: EventType.failed });
  });

  it("releases RTC cleanup before processing completes and then delivers the processed blob", async () => {
    let complete!: (blob: Blob) => void;
    processRecording.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const s = setup();
    const recorder = await s.start();
    const stopped = s.controller.stop(Reason.generationEnded);
    await recorder.finalize();
    await stopped;
    expect(s.events).toHaveLength(0);
    expect(AudioContextStub.instances[0]!.close).toHaveBeenCalledOnce();
    expect(s.videoTrack.stop).not.toHaveBeenCalled();

    const blob = new Blob(["compacted"], { type: "video/mp4" });
    complete(blob);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ type: EventType.interrupted, result: { blob } });
  });

  it("falls back to the original file when post-processing fails", async () => {
    processRecording.mockRejectedValueOnce(new Error("unsupported file"));
    const s = setup();
    const recorder = await s.start();
    s.controller.stop(Reason.generationEnded);
    await recorder.finalize();
    const event = s.events[0]!;
    expect(event.type).toBe(EventType.interrupted);
    if (event.type !== EventType.failed) {
      expect(await event.result.blob.text()).toBe("encoded-video");
    }
  });
});
