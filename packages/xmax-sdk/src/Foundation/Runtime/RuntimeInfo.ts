/**
 * SDK 当前版本号。
 */
export const XMAX_SDK_VERSION = "1.0.2";

export interface RuntimeInfoSnapshot {
  /**
   * 运行平台标识。
   */
  platform: string;

  /**
   * 操作系统或浏览器版本描述。
   */
  osVersion: string;

  /**
   * SDK 版本号。
   */
  sdkVersion: string;

  /**
   * 设备或浏览器型号描述。
   */
  deviceModel: string;
}

/**
 * 描述 SDK 当前运行环境。
 */
export class RuntimeInfo {
  /**
   * 运行环境快照
   */
  /**
   * 当前运行环境快照。
   */
  static readonly current: RuntimeInfoSnapshot = {
    platform: "web",
    osVersion: RuntimeInfo.currentOSVersion(),
    sdkVersion: XMAX_SDK_VERSION,
    deviceModel: "browser",
  };

  /**
   * 序列化为接口传输使用的 snake_case 字段。
   */
  static toJSON(snapshot: RuntimeInfoSnapshot = RuntimeInfo.current): Record<string, string> {
    return {
      platform: snapshot.platform,
      os_version: snapshot.osVersion,
      sdk_version: snapshot.sdkVersion,
      device_model: snapshot.deviceModel,
    };
  }

  /**
   * 读取浏览器 User-Agent；非浏览器环境返回 unknown。
   */
  private static currentOSVersion(): string {
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      return navigator.userAgent;
    }
    return "unknown";
  }
}
