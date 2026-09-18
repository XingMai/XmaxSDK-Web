/**
 * Xmax API 支持的 HTTP 请求方法。
 */
export enum ApiMethod {
  get = "GET",
  post = "POST",
  put = "PUT",
  delete = "DELETE",
}

/**
 * 定义 Xmax API 的基础请求能力。
 *
 * 响应统一按 `{ success, code, message, data }` 信封解析，
 * 各方法返回信封中的 `data` 字段。
 */
export interface ApiServicing {
  /**
   * 发送请求并返回统一响应中的数据。
   *
   * @param method HTTP 请求方法。
   * @param path 相对 Base URL 的请求路径。
   * @param body JSON 请求体；无请求体时省略。
   * @returns 统一响应中的 `data` 字段。
   * @throws 配置无效、网络失败、业务失败或响应无法解析时抛出错误。
   */
  request<T>(method: ApiMethod, path: string, body?: unknown): Promise<T>;

  /** 发送 GET 请求。 */
  get<T>(path: string): Promise<T>;

  /** 发送 POST 请求。 */
  post<T>(path: string, body?: unknown): Promise<T>;

  /** 发送 PUT 请求。 */
  put<T>(path: string, body?: unknown): Promise<T>;

  /** 发送 DELETE 请求。 */
  delete<T>(path: string): Promise<T>;
}
