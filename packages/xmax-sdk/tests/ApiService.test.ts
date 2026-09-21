import { describe, expect, it } from "vitest";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { RuntimeInfo, XMAX_SDK_VERSION } from "../src/Foundation/Runtime/RuntimeInfo";
import { ApiService, type ApiFetch } from "../src/Service/Network/ApiService";
import { ApiMethod } from "../src/Service/Network/ApiServicing";

interface RecordedRequest {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  };
}

function makeApiService(options?: {
  status?: number;
  body?: string;
  throwError?: unknown;
  apiKey?: string;
  baseURL?: string;
}) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: ApiFetch = async (url, init) => {
    requests.push({ url, init });
    if (options?.throwError) {
      throw options.throwError;
    }
    return {
      status: options?.status ?? 200,
      text: async () =>
        options?.body ?? JSON.stringify({ success: true, data: { value: 1 } }),
    };
  };
  const service = new ApiService({
    apiKey: options?.apiKey ?? "test-key",
    baseURL: options?.baseURL ?? "https://api.example.com/open/api/v1",
    fetchImpl,
  });
  return { service, requests };
}

describe("ApiService", () => {
  it("sends request with headers and parses the data envelope", async () => {
    const { service, requests } = makeApiService();
    const data = await service.post<{ value: number }>("/session", {
      model: "x2.0",
    });

    expect(data.value).toBe(1);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe("https://api.example.com/open/api/v1/session");
    expect(request.init.method).toBe(ApiMethod.post);
    expect(request.init.headers["X-Api-Key"]).toBe("test-key");
    expect(request.init.headers["X-Platform"]).toBe("web");
    expect(request.init.headers["X-SDK-Version"]).toBe(XMAX_SDK_VERSION);
    expect(RuntimeInfo.toJSON().sdk_version).toBe(XMAX_SDK_VERSION);
    expect(JSON.parse(request.init.body ?? "")).toEqual({ model: "x2.0" });
  });

  it("maps business failure to apiError with code and message", async () => {
    const { service } = makeApiService({
      status: 200,
      body: JSON.stringify({ success: false, code: 40001, message: " quota exhausted " }),
    });
    await expect(service.get("/session/active")).rejects.toMatchObject({
      code: XmaxErrorCode.apiError,
      message: "quota exhausted",
      apiCode: 40001,
      httpStatus: 200,
    });
  });

  it("maps non-2xx responses to apiError with httpStatus", async () => {
    const { service } = makeApiService({
      status: 500,
      body: JSON.stringify({ success: false, message: "server error" }),
    });
    await expect(service.get("/session/active")).rejects.toMatchObject({
      code: XmaxErrorCode.apiError,
      httpStatus: 500,
    });
  });

  it("maps invalid JSON to apiError", async () => {
    const { service } = makeApiService({ body: "not-json" });
    await expect(service.get("/session/active")).rejects.toMatchObject({
      code: XmaxErrorCode.apiError,
      message: "Server returned invalid JSON",
    });
  });

  it("maps missing data field to apiError", async () => {
    const { service } = makeApiService({
      body: JSON.stringify({ success: true }),
    });
    await expect(service.get("/session/active")).rejects.toMatchObject({
      code: XmaxErrorCode.apiError,
      message: "Server returned invalid response data",
    });
  });

  it("maps transport failure to networkError", async () => {
    const { service } = makeApiService({
      throwError: new TypeError("Failed to fetch"),
    });
    await expect(service.get("/session/active")).rejects.toMatchObject({
      code: XmaxErrorCode.networkError,
    });
  });

  it("maps request timeout to timeout error", async () => {
    const { service } = makeApiService({
      throwError: new DOMException("signal timed out", "TimeoutError"),
    });
    await expect(service.get("/session/active")).rejects.toMatchObject({
      code: XmaxErrorCode.timeout,
    });
  });

  it("rejects empty API key before sending", async () => {
    const { service, requests } = makeApiService({ apiKey: "  " });
    await expect(service.get("/session/active")).rejects.toMatchObject({
      code: XmaxErrorCode.invalidAPIKey,
    });
    expect(requests).toHaveLength(0);
  });

  it("rejects absolute request paths", async () => {
    const { service } = makeApiService();
    await expect(
      service.get("https://evil.example.com/session"),
    ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
  });

  it("rejects insecure base URL except localhost", async () => {
    const { service } = makeApiService({
      baseURL: "http://api.example.com/open/api/v1",
    });
    await expect(service.get("/session/active")).rejects.toMatchObject({
      code: XmaxErrorCode.invalidConfiguration,
    });

    const local = makeApiService({ baseURL: "http://localhost:8080/open/api/v1" });
    const data = await local.service.get<{ value: number }>("/session/active");
    expect(data.value).toBe(1);
  });
});
