import { XmaxError, XmaxErrorCode } from "../Errors/XmaxError";
import { XmaxLogger } from "../Logging/XmaxLogger";
import type { PermissionManaging } from "./PermissionManaging";

/**
 * Web 权限管理。
 *
 * Web 上权限通过 getUserMedia 隐式申请；这里用 Permissions API 做预检
 * （Safari 对 camera/microphone 查询支持不完整，查询不可用时跳过预检，
 * 由采集阶段的 DOMException 映射兜底）。
 */
export class PermissionManager implements PermissionManaging {
  /**
   * 确保相机权限可用。
   * @throws 权限被拒绝或浏览器不支持媒体采集时抛出 `cameraPermissionDenied`。
   */
  async ensureCameraPermission(): Promise<void> {
    await this.ensurePermission("camera", XmaxErrorCode.cameraPermissionDenied);
  }

  /**
   * 确保麦克风权限可用。
   * @throws 权限被拒绝或浏览器不支持媒体采集时抛出 `microphonePermissionDenied`。
   */
  async ensureMicrophonePermission(): Promise<void> {
    await this.ensurePermission(
      "microphone",
      XmaxErrorCode.microphonePermissionDenied,
    );
  }

  /**
   * 通过 Permissions API 预检指定设备权限。
   *
   * @param name 设备权限名称。
   * @param deniedCode 权限被拒绝时抛出的错误码。
   */
  private async ensurePermission(
    name: "camera" | "microphone",
    deniedCode: XmaxErrorCode,
  ): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new XmaxError(
        deniedCode,
        "This browser does not support media capture (getUserMedia)",
      );
    }

    try {
      const permissions = navigator.permissions;
      if (!permissions?.query) {
        return;
      }
      // TS 标准库未包含 camera/microphone 描述名，按运行时能力调用。
      const status = await permissions.query({
        name: name as PermissionName,
      });
      if (status.state === "denied") {
        throw new XmaxError(
          deniedCode,
          `${name === "camera" ? "Camera" : "Microphone"} permission was denied`,
        );
      }
    } catch (error) {
      if (error instanceof XmaxError) {
        throw error;
      }
      // 浏览器不支持该权限查询（如部分 Safari 版本），跳过预检。
      XmaxLogger.permission.debug(
        () => `Permission query for ${name} is unavailable; skip pre-check`,
      );
    }
  }
}
