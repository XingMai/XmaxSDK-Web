import { afterEach, describe, expect, it, vi } from "vitest";
import { XmaxClient, XmaxConfiguration, XmaxEnvironment, NonRealtimeQuality, NonRealtimeTaskStatus, NonRealtimeTaskError } from "../src/index";
import { XmaxNonRealtimeManager } from "../src/Core/NonRealtime/XmaxNonRealtimeManager";
import { NonRealtimeTaskService } from "../src/Service/NonRealtime/NonRealtimeTaskService";
import { ApiService, type ApiFetch } from "../src/Service/Network/ApiService";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import type { NonRealtimeTaskOptions } from "../src/Service/NonRealtime/NonRealtimeTask";

const uid = "uot-test";
const submitted = { uid, status: "submitted" };
const processing = { uid, status: "processing" };
const completed = { uid, status: "completed", result: { result_url: "https://media.example/result.mp4", upload_status: "success" } };
const options: NonRealtimeTaskOptions = {
  videoPath: "https://media.example/video.mp4", prompt: "  change clothes  ", quality: NonRealtimeQuality.hd,
};

function response(data: unknown, status = 200, code = 200) {
  return { status, text: async () => JSON.stringify({ success: status === 200, code, data }) };
}

function setup() {
  const fetch = vi.fn<ApiFetch>().mockResolvedValue(response(submitted));
  const api = new ApiService({ apiKey: "test-key", baseURL: "https://api.example/open/api/v1", fetchImpl: fetch });
  const manager = new XmaxNonRealtimeManager(new NonRealtimeTaskService(api));
  return { manager, fetch };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NonRealtime task API", () => {
  it.each([
    [XmaxEnvironment.china, "https://api.xmaxai.com"],
    [XmaxEnvironment.global, "https://api.xmax.ai"],
  ])("creates a manager without requests and uses the %s endpoint and client key", async (environment, origin) => {
    const fetch = vi.fn().mockResolvedValue(response(submitted));
    vi.stubGlobal("fetch", fetch);
    const client = new XmaxClient(new XmaxConfiguration({ apiKey: "test-key", environment: environment as XmaxEnvironment }));
    const manager = client.createNonRealtimeManager();
    expect(fetch).not.toHaveBeenCalled();
    const task = await manager.submitTask(options);
    expect(task).toMatchObject(submitted);
    expect(fetch).toHaveBeenCalledWith(`${origin}/open/api/v1/offline-task`, expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ "X-Api-Key": "test-key" }),
    }));

    await manager.getTask(uid);
    fetch.mockResolvedValueOnce(response({ list: [submitted] }));
    await manager.getTasks([uid]);
    fetch.mockResolvedValueOnce(response({ pageNumber: 1, pageSize: 10, total: 1, list: [submitted] }));
    await manager.listTasks();
    fetch.mockResolvedValueOnce(response(completed));
    await manager.waitForCompletion(uid);

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${origin}/open/api/v1/offline-task`,
      `${origin}/open/api/v1/offline-task/${uid}`,
      `${origin}/open/api/v1/offline-task/batch-query`,
      `${origin}/open/api/v1/offline-task/page?pageNumber=1&pageSize=10`,
      `${origin}/open/api/v1/offline-task/${uid}`,
    ]);
  });

  it("maps submit fields and leaves omitted fps and reference absent", async () => {
    const { manager, fetch } = setup();
    await manager.submitTask(options);
    expect(JSON.parse(fetch.mock.calls[0]![1].body!)).toEqual({ prompt: "change clothes", refVideoPath: options.videoPath, quality: "hd" });
    await manager.submitTask({ ...options, referencePath: "https://media.example/reference.jpg", fps: 24 });
    expect(JSON.parse(fetch.mock.calls[1]![1].body!)).toMatchObject({ refImagePath: "https://media.example/reference.jpg", fps: 24 });
  });

  it.each([
    { prompt: "  " }, { prompt: "a".repeat(1025) }, { quality: "ultra" },
    { fps: 29.97 }, { fps: 7 }, { fps: 14 }, { fps: NaN }, { fps: 121 },
    { videoPath: "blob:local" }, { videoPath: "/video.mp4" }, { videoPath: "file:///video.mp4" },
    { referencePath: "" }, { referencePath: "data:image/png;base64,AA" }, { videoPath: "https://u:p@example.com/a" },
  ])("rejects invalid input before a paid request: %j", async (invalid) => {
    const { manager, fetch } = setup();
    await expect(manager.submitTask({ ...options, ...invalid } as NonRealtimeTaskOptions)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts every documented processing fps", async () => {
    const { manager } = setup();
    for (const fps of [8, 10, 12, 15, 16, 18, 20, 22, 24, 25, 30, 45, 48, 50, 60, 72, 90, 100, 120]) {
      await expect(manager.submitTask({ ...options, fps })).resolves.toMatchObject(submitted);
    }
  });

  it("never retries a submission after a timeout, network failure or malformed response", async () => {
    const { manager, fetch } = setup();
    fetch.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    await expect(manager.submitTask(options)).rejects.toMatchObject({ code: XmaxErrorCode.timeout });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockRejectedValueOnce(new TypeError("network"));
    await expect(manager.submitTask(options)).rejects.toMatchObject({ code: XmaxErrorCode.networkError });
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockResolvedValueOnce(response({ status: "submitted" }));
    await expect(manager.submitTask(options)).rejects.toMatchObject({ code: XmaxErrorCode.apiError });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("maps all task/result fields and preserves null, zero and fractional fps correctly", async () => {
    const { manager, fetch } = setup();
    fetch.mockResolvedValueOnce(response({
      ...completed, userUid: "user-1", prompt: "p", refVideoPath: options.videoPath, refImagePath: null,
      processorId: null, quality: "sd", requestedFps: null, resolvedFps: 29.97, retryCount: 0,
      videoDurationSeconds: 8.4, billableDurationSeconds: 8.4, chargePoints: 10,
      processStartTime: null, createTimestamp: "created", updateTimestamp: "updated",
      result: { ...completed.result, upload_error: null, finalize_duration_ms: 3, compression_level: null,
        frame_count: 250, fps: 29.97, result_duration_ms: 8341, file_size_bytes: 1000,
        dropped_frame_count: 0, original_file_size_bytes: 1500 },
    }));
    const task = await manager.getTask(uid);
    expect(task).toEqual({
      uid, status: "completed", userUid: "user-1", prompt: "p", videoPath: options.videoPath,
      referencePath: undefined, processorId: undefined, quality: "sd", requestedFps: undefined,
      resolvedFps: 29.97, retryCount: 0, videoDurationSeconds: 8.4, billableDurationSeconds: 8.4, chargePoints: 10,
      processStartTime: undefined, createTimestamp: "created", updateTimestamp: "updated",
      result: { url: completed.result.result_url, uploadStatus: "success", uploadError: undefined,
        finalizeDurationMs: 3, compressionLevel: undefined, frameCount: 250, fps: 29.97,
        durationMs: 8341, fileSizeBytes: 1000, droppedFrameCount: 0, originalFileSizeBytes: 1500 },
    });
    expect(Object.isFrozen(task)).toBe(true);
    expect(Object.isFrozen(task.result)).toBe(true);
  });

  it("encodes task IDs as one path segment and rejects dot segments", async () => {
    const { manager, fetch } = setup();
    fetch.mockResolvedValueOnce(response({ uid: "a/b?c", status: "processing" }));
    await manager.getTask("a/b?c");
    expect(fetch.mock.calls[0]![0]).toBe("https://api.example/open/api/v1/offline-task/a%2Fb%3Fc");
    for (const id of ["", " ", ".", ".."]) {
      await expect(manager.getTask(id)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { uid }, { uid, status: "unknown" }, { uid: "other", status: "completed" }, { ...submitted, result: [] }])("rejects malformed task response %j", async (payload) => {
    const { manager, fetch } = setup();
    fetch.mockResolvedValueOnce(response(payload));
    await expect(manager.getTask(uid)).rejects.toMatchObject({ code: XmaxErrorCode.apiError });
  });

  it("deduplicates batch IDs and validates the returned order", async () => {
    const { manager, fetch } = setup();
    fetch.mockResolvedValueOnce(response({ list: [submitted, { ...processing, uid: "second" }] }));
    expect((await manager.getTasks([uid, uid, "second"])).map((task) => task.uid)).toEqual([uid, "second"]);
    expect(JSON.parse(fetch.mock.calls[0]![1].body!)).toEqual({ taskUids: [uid, "second"] });
    fetch.mockResolvedValueOnce(response({ list: [] }));
    await expect(manager.getTasks([uid])).rejects.toMatchObject({ code: XmaxErrorCode.apiError });
    await expect(manager.getTasks([])).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    await expect(manager.getTasks(Array(101).fill(uid))).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("maps a page, applies defaults and forwards filters", async () => {
    const { manager, fetch } = setup();
    fetch.mockResolvedValue(response({ pageNumber: 1, pageSize: 10, total: 0, list: [] }));
    expect(await manager.listTasks()).toEqual({ pageNumber: 1, pageSize: 10, total: 0, list: [] });
    expect(fetch.mock.calls[0]![0]).toBe("https://api.example/open/api/v1/offline-task/page?pageNumber=1&pageSize=10");
    await manager.listTasks({ pageNumber: 2, pageSize: 20, status: NonRealtimeTaskStatus.completed });
    expect(fetch.mock.calls[1]![0]).toBe("https://api.example/open/api/v1/offline-task/page?pageNumber=2&pageSize=20&status=completed");
    for (const query of [{ pageNumber: 0 }, { pageNumber: 1.5 }, { pageSize: 101 }, { pageSize: 0 }, { pageSize: NaN }]) {
      await expect(manager.listTasks(query)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("NonRealtime polling", () => {
  it("polls serially, emits snapshots and stops at completion", async () => {
    vi.useFakeTimers();
    const { manager, fetch } = setup();
    fetch.mockResolvedValueOnce(response(submitted)).mockResolvedValueOnce(response(processing)).mockResolvedValueOnce(response(completed));
    const onTaskUpdated = vi.fn();
    const waiting = manager.waitForCompletion(uid, { intervalMs: 100, onTaskUpdated });
    await vi.advanceTimersByTimeAsync(200);
    expect((await waiting).result!.url).toBe(completed.result.result_url);
    expect(onTaskUpdated.mock.calls.map(([task]) => task.status)).toEqual(["submitted", "processing", "completed"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns error tasks when queried, but rejects waits with the task attached", async () => {
    const { manager, fetch } = setup();
    fetch.mockResolvedValue(response({ uid, status: "error" }));
    expect((await manager.getTask(uid)).status).toBe("error");
    await expect(manager.waitForCompletion(uid)).rejects.toMatchObject({ name: "NonRealtimeTaskError", task: { uid, status: "error" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, {}, { result_url: "blob:bad" }, { result_url: "https://media.example/result", upload_status: "failed" },
    { result_url: "https://media.example/result", upload_error: "upload failed" }])("rejects unusable completed results %j", async (result) => {
    const { manager, fetch } = setup();
    fetch.mockResolvedValue(response({ ...completed, result }));
    await expect(manager.waitForCompletion(uid)).rejects.toBeInstanceOf(NonRealtimeTaskError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels between polls without deleting the task, and can resume", async () => {
    vi.useFakeTimers();
    const { manager, fetch } = setup();
    const controller = new AbortController();
    const waiting = manager.waitForCompletion(uid, { signal: controller.signal });
    const rejected = expect(waiting).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(response(completed));
    await expect(manager.waitForCompletion(uid)).resolves.toMatchObject({ status: "completed" });
    expect(fetch.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("does not query for an already aborted wait", async () => {
    const { manager, fetch } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(manager.waitForCompletion(uid, { signal: controller.signal })).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["cancel", "timeout"])("interrupts an in-flight HTTP query on %s", async (mode) => {
    vi.useFakeTimers();
    const { manager, fetch } = setup();
    fetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    const controller = new AbortController();
    const waiting = manager.waitForCompletion(uid, { signal: controller.signal, timeoutMs: 100 });
    const rejected = expect(waiting).rejects.toMatchObject({ code: mode === "cancel" ? XmaxErrorCode.cancelled : XmaxErrorCode.timeout });
    await vi.advanceTimersByTimeAsync(50);
    expect(fetch).toHaveBeenCalledTimes(1);
    if (mode === "cancel") controller.abort();
    else await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(fetch.mock.calls[0]![1].signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limits transient retries and backs off without overlapping requests", async () => {
    vi.useFakeTimers();
    const { manager, fetch } = setup();
    fetch.mockRejectedValue(new TypeError("network unavailable"));
    const rejected = expect(manager.waitForCompletion(uid, { intervalMs: 100, maxConsecutiveRetries: 2 }))
      .rejects.toMatchObject({ code: XmaxErrorCode.networkError });
    await vi.advanceTimersByTimeAsync(99);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a temporary server failure but never a business denial reported with HTTP 500", async () => {
    vi.useFakeTimers();
    const { manager, fetch } = setup();
    fetch.mockResolvedValueOnce(response(undefined, 503, 503)).mockResolvedValueOnce(response(completed));
    const waiting = manager.waitForCompletion(uid, { intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(waiting).resolves.toMatchObject({ status: "completed" });
    fetch.mockResolvedValueOnce(response(undefined, 500, 46018));
    await expect(manager.waitForCompletion(uid)).rejects.toMatchObject({ apiCode: 46018 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("times out while sleeping and stops polling", async () => {
    vi.useFakeTimers();
    const { manager, fetch } = setup();
    const rejected = expect(manager.waitForCompletion(uid, { intervalMs: 100, timeoutMs: 50 }))
      .rejects.toMatchObject({ code: XmaxErrorCode.timeout });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    await vi.advanceTimersByTimeAsync(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for a slow request to finish before scheduling the next query", async () => {
    vi.useFakeTimers();
    const { manager, fetch } = setup();
    let resolve!: (value: Awaited<ReturnType<ApiFetch>>) => void;
    fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue(response(completed));
    const waiting = manager.waitForCompletion(uid, { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(response(processing));
    await vi.advanceTimersByTimeAsync(99);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toMatchObject({ status: "completed" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("resets retries after a successful query and ignores observer errors", async () => {
    vi.useFakeTimers();
    const { manager, fetch } = setup();
    fetch.mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(response(processing))
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(response(completed));
    const callback = vi.fn().mockImplementationOnce(() => { throw new Error("observer"); }).mockRejectedValueOnce(new Error("async observer"));
    const waiting = manager.waitForCompletion(uid, { intervalMs: 10, maxConsecutiveRetries: 1, onTaskUpdated: callback });
    await vi.advanceTimersByTimeAsync(30);
    await expect(waiting).resolves.toMatchObject({ status: "completed" });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it.each([46018, 46024, 46025])("does not retry business error %s", async (code) => {
    const { manager, fetch } = setup();
    fetch.mockResolvedValue(response(undefined, 403, code));
    await expect(manager.waitForCompletion(uid)).rejects.toMatchObject({ apiCode: code });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("allows independent waits on one manager", async () => {
    vi.useFakeTimers();
    const { manager, fetch } = setup();
    fetch.mockImplementation(async (url) => response({ ...submitted, uid: url.split("/").at(-1) }));
    const a = new AbortController();
    const b = new AbortController();
    const first = expect(manager.waitForCompletion("first", { signal: a.signal, intervalMs: 100 })).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    const second = expect(manager.waitForCompletion("second", { signal: b.signal, intervalMs: 100 })).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await vi.advanceTimersByTimeAsync(0);
    a.abort();
    await first;
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch.mock.calls.map(([url]) => url.split("/").at(-1))).toEqual(["first", "second", "second"]);
    b.abort();
    await second;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ intervalMs: 0 }, { intervalMs: NaN }, { timeoutMs: -1 }, { timeoutMs: Infinity }, { maxConsecutiveRetries: -1 }, { maxConsecutiveRetries: 1.5 }])("rejects invalid polling options %j", async (config) => {
    const { manager, fetch } = setup();
    await expect(manager.waitForCompletion(uid, config)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(fetch).not.toHaveBeenCalled();
  });
});
