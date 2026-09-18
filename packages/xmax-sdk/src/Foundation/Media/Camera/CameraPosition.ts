/**
 * 相机采集使用的镜头方向。
 *
 * Web 上映射为 getUserMedia 的 facingMode（front → "user"，back → "environment"）；
 * 桌面设备通常只有前置等价摄像头，back 会回退到可用设备。
 */
export enum CameraPosition {
  /** 前置摄像头（面向用户）。 */
  front = "front",

  /** 后置摄像头（面向环境）。 */
  back = "back",
}
