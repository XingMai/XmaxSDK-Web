/**
 * 定义相机与麦克风权限保障能力。
 */
export interface PermissionManaging {
  /**
   * 确保相机权限可用。
   * @throws 权限被拒绝或不可用时抛出 `cameraPermissionDenied`。
   */
  ensureCameraPermission(): Promise<void>;

  /**
   * 确保麦克风权限可用。
   * @throws 权限被拒绝或不可用时抛出 `microphonePermissionDenied`。
   */
  ensureMicrophonePermission(): Promise<void>;
}
