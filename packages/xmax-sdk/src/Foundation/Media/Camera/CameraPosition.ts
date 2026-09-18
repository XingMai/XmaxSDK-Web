/**
 * 相机采集使用的镜头方向。
 *
 * 采集时映射为 RTC 层的前后置选择；桌面设备通常只有前置等价
 * 摄像头，back 会回退到可用设备。
 */
export enum CameraPosition {
  /** 前置摄像头（面向用户）。 */
  front = "front",

  /** 后置摄像头（面向环境）。 */
  back = "back",
}
