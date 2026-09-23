/**
 * Xmax 服务环境。
 */
export enum XmaxEnvironment {
  /**
   * 国内环境。
   */
  china = "china",

  /**
   * 海外环境。
   */
  global = "global",
}

const API_BASE_URLS: Record<XmaxEnvironment, string> = {
  /**
   * 临时联调环境。
   */
  [XmaxEnvironment.china]: "https://dev.xmaxai.com/open/api/v1",
  [XmaxEnvironment.global]: "https://api.xmax.cloud/open/api/v1",
};

/**
 * 环境对应的 Xmax API Base URL。
 */
export function apiBaseURL(environment: XmaxEnvironment): string {
  return API_BASE_URLS[environment];
}
