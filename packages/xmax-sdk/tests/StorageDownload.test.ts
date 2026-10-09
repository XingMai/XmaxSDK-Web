import { afterEach, describe, expect, it, vi } from "vitest";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { ApiService } from "../src/Service/Network/ApiService";
import { StorageService } from "../src/Service/Storage/StorageService";

function setup() {
  vi.useFakeTimers();
  const data = new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => data });
  vi.stubGlobal("fetch", fetchMock);
  const link = { href: "", download: "", hidden: false, click: vi.fn(), remove: vi.fn() };
  const appendChild = vi.fn();
  vi.stubGlobal("document", { body: { appendChild }, createElement: vi.fn(() => link) });
  const createURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download-test");
  const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const api = new ApiService({ apiKey: "private-key", baseURL: "https://api.example" });
  const getCredentials = vi.spyOn(api, "get");
  const service = new StorageService({ apiService: api });
  return { service, data, fetchMock, link, appendChild, createURL, revokeURL, getCredentials };
}

const options = { url: "https://media.example/video.mp4?signature=test", fileName: "video.mp4" };

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StorageService.downloadVideo", () => {
  it("downloads original bytes without credentials and requests saving with the supplied name", async () => {
    const { service, data, fetchMock, link, appendChild, createURL, revokeURL, getCredentials } = setup();

    await service.downloadVideo({ ...options, fileName: "  我的 视频.mp4  " });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(options.url, { credentials: "omit", signal: undefined });
    expect(getCredentials).not.toHaveBeenCalled();
    expect(createURL).toHaveBeenCalledWith(data);
    expect(link).toMatchObject({ href: "blob:download-test", download: "我的 视频.mp4", hidden: true });
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revokeURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeURL).toHaveBeenCalledOnce();
    expect(revokeURL).toHaveBeenCalledWith("blob:download-test");
  });

  it.each(["", "not-a-url", "/video.mp4", "javascript:alert(1)", "file:///video.mp4", "https://user:pass@media.example/video.mp4"])("rejects invalid resource URL %s before requesting data", async (url) => {
    const { service, fetchMock } = setup();
    await expect(service.downloadVideo({ ...options, url })).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([" ", "a/b.mp4", "a\\b.mp4"])("rejects invalid file name %s before requesting data", async (fileName) => {
    const { service, fetchMock } = setup();
    await expect(service.downloadVideo({ ...options, fileName })).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects outside a browser before requesting data", async () => {
    const { service, fetchMock } = setup();
    vi.stubGlobal("document", undefined);
    await expect(service.downloadVideo(options)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([403, 404, 500])("preserves HTTP status %s without saving the error body", async (status) => {
    const { service, fetchMock, createURL, link } = setup();
    const blob = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status, blob });
    await expect(service.downloadVideo(options)).rejects.toMatchObject({ code: XmaxErrorCode.downloadError, httpStatus: status });
    expect(blob).not.toHaveBeenCalled();
    expect(createURL).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
  });

  it("maps network and body-read failures to download errors", async () => {
    const { service, fetchMock, link } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(service.downloadVideo(options)).rejects.toMatchObject({ code: XmaxErrorCode.downloadError });
    fetchMock.mockResolvedValueOnce({ ok: true, blob: async () => { throw new Error("Connection interrupted"); } });
    await expect(service.downloadVideo(options)).rejects.toMatchObject({ code: XmaxErrorCode.downloadError });
    expect(link.click).not.toHaveBeenCalled();
  });

  it("does not save an empty response", async () => {
    const { service, fetchMock, createURL } = setup();
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob() });
    await expect(service.downloadVideo(options)).rejects.toMatchObject({ code: XmaxErrorCode.downloadError });
    expect(createURL).not.toHaveBeenCalled();
  });

  it("rejects an already cancelled download without a request", async () => {
    const { service, fetchMock } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(service.downloadVideo({ ...options, signal: controller.signal })).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes cancellation to fetch and does not request saving after abort", async () => {
    const { service, fetchMock, createURL } = setup();
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const download = service.downloadVideo({ ...options, signal: controller.signal });
    controller.abort();
    await expect(download).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal);
    expect(createURL).not.toHaveBeenCalled();
  });

  it("checks cancellation again after reading the response", async () => {
    const { service, data, fetchMock, createURL } = setup();
    const controller = new AbortController();
    fetchMock.mockResolvedValue({ ok: true, blob: async () => { controller.abort(); return data; } });
    await expect(service.downloadVideo({ ...options, signal: controller.signal })).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(createURL).not.toHaveBeenCalled();
  });

  it("releases the link and Blob URL immediately if requesting browser saving fails", async () => {
    const { service, link, revokeURL } = setup();
    link.click.mockImplementation(() => { throw new Error("Save failed"); });
    await expect(service.downloadVideo(options)).rejects.toMatchObject({ code: XmaxErrorCode.downloadError });
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revokeURL).toHaveBeenCalledOnce();
    expect(revokeURL).toHaveBeenCalledWith("blob:download-test");
    expect(vi.getTimerCount()).toBe(0);
  });
});
