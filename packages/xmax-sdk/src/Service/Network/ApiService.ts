import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { XMAX_SDK_VERSION } from "../../Foundation/Runtime/RuntimeInfo";
import { ApiMethod, type ApiServicing } from "./ApiServicing";

/** Xmax API 统一响应信封中的公共元数据。 */
interface EnvelopeMetadata {
  success?: boolean;
  code?: number;
  message?: string;
}

/** 请求 fetch 时使用的签名，便于测试替换。 */
export type ApiFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface ApiServiceOptions {
  /** 调用 Xmax 服务使用的 API Key。 */
  apiKey: string;

  /** Xmax API Base URL。 */
  baseURL: string;

  /** 请求超时时间（毫秒）；默认 15 秒。 */
  timeoutMs?: number;

  /** fetch 实现（可替换，测试用）。 */
  fetchImpl?: ApiFetch;
}

/**
 * 负责发送 Xmax API 请求并统一处理响应、日志和错误。
 */
export class ApiService implements ApiServicing {
  // API 配置
  /** 默认请求超时时间（毫秒）。 */
  static readonly defaultTimeoutMs = 15_000;

  // 平台资源
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: ApiFetch;

  /**
   * 创建 API Service。
   *
   * @param options.apiKey 调用 Xmax 服务使用的 API Key。
   * @param options.baseURL Xmax API Base URL。
   * @param options.timeoutMs 请求超时时间（毫秒）；默认 15 秒。
   * @param options.fetchImpl fetch 实现（可替换，测试用）。
   */
  constructor(options: ApiServiceOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseURL = options.baseURL;
    this.timeoutMs = options.timeoutMs ?? ApiService.defaultTimeoutMs;
    this.fetchImpl =
      options.fetchImpl ??
      ((url, init) => fetch(url, init) as Promise<{ status: number; text(): Promise<string> }>);
  }

  /** 发送请求并返回统一响应中的数据。 */
  async request<T>(method: ApiMethod, path: string, body?: unknown): Promise<T> {
    this.validateConfiguration();
    const request = this.makeRequest(method, path, body);
    const startedAt = Date.now();

    let status: number;
    let text: string;
    try {
      const response = await this.fetchImpl(request.url, request.init);
      status = response.status;
      text = await response.text();
    } catch (error) {
      const mapped = ApiService.transportError(error);
      this.logFailure(method, path, mapped, startedAt);
      throw mapped;
    }

    try {
      const value = ApiService.parseResponse<T>(text, status);
      XmaxLogger.api.debug(
        () =>
          `API 请求成功 (API Request Succeeded)\n` +
          `└─ ${method} ${path} · ${status} · ${Date.now() - startedAt}ms`,
      );
      return value;
    } catch (error) {
      const mapped = XmaxError.from(error);
      this.logFailure(method, path, mapped, startedAt);
      throw mapped;
    }
  }

  /** 发送 GET 请求。 */
  get<T>(path: string): Promise<T> {
    return this.request<T>(ApiMethod.get, path);
  }

  /** 发送 POST 请求。 */
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(ApiMethod.post, path, body);
  }

  /** 发送 PUT 请求。 */
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(ApiMethod.put, path, body);
  }

  /** 发送 DELETE 请求。 */
  delete<T>(path: string): Promise<T> {
    return this.request<T>(ApiMethod.delete, path);
  }

  /** 校验 API Key 与 Base URL 配置。 */
  private validateConfiguration(): void {
    if (this.apiKey.length === 0) {
      throw new XmaxError(XmaxErrorCode.invalidAPIKey, "API key cannot be empty");
    }
    let url: URL;
    try {
      url = new URL(this.baseURL);
    } catch {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "API service configuration is invalid",
      );
    }
    const isSecure = url.protocol === "https:";
    const isLocalhost =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if ((!isSecure && !isLocalhost) || this.timeoutMs <= 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "API service configuration is invalid",
      );
    }
  }

  /** 构造请求地址、请求头与请求体；路径必须相对且与 Base URL 同源。 */
  private makeRequest(
    method: ApiMethod,
    path: string,
    body?: unknown,
  ): { url: string; init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal } } {
    const normalizedPath = path.trim();
    if (
      normalizedPath.length === 0 ||
      normalizedPath.includes("://") ||
      normalizedPath.startsWith("//")
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "API request path is invalid",
      );
    }

    const base = this.baseURL.endsWith("/") ? this.baseURL.slice(0, -1) : this.baseURL;
    const relativePath = normalizedPath.startsWith("/")
      ? normalizedPath
      : `/${normalizedPath}`;
    const url = new URL(base + relativePath);
    const baseURLObj = new URL(base);
    if (
      url.protocol.toLowerCase() !== baseURLObj.protocol.toLowerCase() ||
      url.host.toLowerCase() !== baseURLObj.host.toLowerCase()
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "API request path is invalid",
      );
    }

    let encodedBody: string | undefined;
    if (body !== undefined) {
      try {
        encodedBody = JSON.stringify(body);
      } catch {
        throw new XmaxError(
          XmaxErrorCode.apiError,
          "Failed to encode API request body",
        );
      }
    }

    return {
      url: url.toString(),
      init: {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Api-Key": this.apiKey,
          "X-Platform": "web",
          "X-SDK-Version": XMAX_SDK_VERSION,
        },
        body: encodedBody,
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    };
  }

  /** 解析统一响应信封并返回数据；业务失败或数据缺失时抛出错误。 */
  private static parseResponse<T>(text: string, status: number): T {
    let envelope: EnvelopeMetadata & { data?: T };
    try {
      envelope = JSON.parse(text);
    } catch {
      throw new XmaxError(XmaxErrorCode.apiError, "Server returned invalid JSON", {
        httpStatus: status,
      });
    }

    const ok = status >= 200 && status < 300;
    if (!ok || envelope.success !== true) {
      const message = envelope.message?.trim();
      throw new XmaxError(
        XmaxErrorCode.apiError,
        message && message.length > 0 ? message : "Xmax API request failed",
        { apiCode: envelope.code, httpStatus: status },
      );
    }

    if (envelope.data === undefined || envelope.data === null) {
      throw new XmaxError(
        XmaxErrorCode.apiError,
        "Server returned invalid response data",
        { httpStatus: status },
      );
    }
    return envelope.data;
  }

  /** 将传输层异常映射为 SDK 统一错误。 */
  private static transportError(error: unknown): XmaxError {
    if (error instanceof XmaxError) {
      return error;
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return new XmaxError(XmaxErrorCode.timeout, "API request timed out");
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return new XmaxError(XmaxErrorCode.cancelled, "API request was cancelled");
    }
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : String(error);
    return new XmaxError(
      XmaxErrorCode.networkError,
      `HTTP request failed: ${message}`,
    );
  }

  /** 输出失败日志。 */
  private logFailure(
    method: ApiMethod,
    path: string,
    error: XmaxError,
    startedAt: number,
  ): void {
    XmaxLogger.api.error(
      () =>
        `API 请求失败 (API Request Failed)\n` +
        `└─ ${method} ${path} · ${Date.now() - startedAt}ms\n` +
        `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${error.message}`,
    );
  }
}
