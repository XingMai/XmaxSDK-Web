/**
 * SDK 向接入方暴露的统一错误码。
 */
export enum XmaxErrorCode {
  /**
   * API Key 未配置或为空。
   */
  invalidAPIKey = "INVALID_API_KEY",

  /**
   * 调用参数、配置或当前生命周期状态不符合操作要求。
   */
  invalidConfiguration = "INVALID_CONFIGURATION",

  /**
   * SDK 内部发生无法归类的非预期错误。
   */
  internalError = "INTERNAL_ERROR",

  /**
   * 网络不可用、连接失败或 HTTP 请求无法完成。
   */
  networkError = "NETWORK_ERROR",

  /**
   * Xmax API 返回业务失败，或者响应数据无法正确解析。
   */
  apiError = "API_ERROR",

  /**
   * 实时生成会话数据缺失、会话关闭或心跳状态异常。
   */
  sessionError = "SESSION_ERROR",

  /**
   * RTC Engine、房间、媒体传输或渲染绑定发生错误。
   */
  rtcError = "RTC_ERROR",

  /**
   * 本地媒体读取、解码、同步或帧处理发生错误。
   */
  mediaError = "MEDIA_ERROR",

  /**
   * 当前系统、设备或视频规格不支持远端视频插帧。
   */
  frameInterpolationUnsupported = "FRAME_INTERPOLATION_UNSUPPORTED",

  /**
   * 接入方未授予相机权限。
   */
  cameraPermissionDenied = "CAMERA_PERMISSION_DENIED",

  /**
   * @deprecated 为兼容保留；相机预热改为固定等待，不再抛出此错误。
   */
  cameraExposureTimeout = "CAMERA_EXPOSURE_TIMEOUT",

  /**
   * 接入方未授予麦克风权限。
   */
  microphonePermissionDenied = "MICROPHONE_PERMISSION_DENIED",

  /**
   * 文件或二进制数据上传失败。
   */
  uploadError = "UPLOAD_ERROR",

  /**
   * 远端文件下载失败。
   */
  downloadError = "DOWNLOAD_ERROR",

  /**
   * 图片未通过内容安全检查。
   */
  unsafeImage = "UNSAFE_IMAGE",

  /**
   * 操作因生命周期切换或接入方主动终止而正常取消。
   */
  cancelled = "CANCELLED",

  /**
   * 等待连接、房间事件或生成结果超过规定时间。
   */
  timeout = "TIMEOUT",
}

/**
 * SDK 内部组件上报统一错误时使用的监听器。
 */
export type XmaxErrorListener = (error: XmaxError) => void;

/**
 * 表示 SDK 抛出或回调给接入方的统一错误。
 */
export class XmaxError extends Error {
  /**
   * 错误信息
   */
  /**
   * SDK 统一错误码。
   */
  readonly code: XmaxErrorCode;

  /**
   * Xmax API 返回的业务错误码；非 API 业务错误时为空。
   */
  readonly apiCode?: number;

  /**
   * HTTP 响应状态码；请求未获得响应时为空。
   */
  readonly httpStatus?: number;

  /**
   * 创建 SDK 错误。
   *
   * @param code SDK 统一错误码。
   * @param message 面向接入方的可读错误说明。
   * @param options Xmax API 业务错误码与 HTTP 状态码（可选）。
   */
  constructor(
    code: XmaxErrorCode,
    message: string,
    options?: { apiCode?: number; httpStatus?: number },
  ) {
    super(message);
    this.name = "XmaxError";
    this.code = code;
    this.apiCode = options?.apiCode;
    this.httpStatus = options?.httpStatus;
  }

  /**
   * 将未知错误转换为 SDK 内部错误，已有 `XmaxError` 原样返回。
   *
   * @param error 待转换的错误。
   * @returns 可向接入方抛出或回调的统一错误。
   */
  static from(error: unknown): XmaxError {
    if (error instanceof XmaxError) {
      return error;
    }
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : String(error);
    return new XmaxError(XmaxErrorCode.internalError, message);
  }
}
