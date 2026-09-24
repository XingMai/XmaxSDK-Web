/**
 * TRTC 视频方向环境参数；缺省时读取浏览器全局对象（可注入，测试用）。
 */
export interface RtcOrientationEnvironment {
  userAgent?: string;
  maxTouchPoints?: number;

  /**
   * `screen.orientation.type`，如 `"portrait-primary"`。
   */
  orientationType?: string;

  /**
   * 旧式 `window.orientation` 角度；无 `orientationType` 时使用。
   */
  orientationDegrees?: number;
}

/**
 * 判断当前是否为移动端竖屏。
 *
 * TRTC 在移动端竖屏下会把视频宽高按设备方向转置输出：传横屏
 * profile 实际得到竖屏上行，传竖屏 profile 反而得到横屏上行。
 * 为让上行方向与请求一致，移动端竖屏时传给 TRTC 的尺寸需反向转置。
 */
export function shouldTransposeRtcVideoSize(
  environment?: RtcOrientationEnvironment,
): boolean {
  const userAgent =
    environment?.userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  const maxTouchPoints =
    environment?.maxTouchPoints ??
    (typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints ?? 0);

  // 桌面模式 UA 的 iPad 通过触控点数识别。
  const mobile =
    /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  if (!mobile) {
    return false;
  }

  const orientationType =
    environment?.orientationType ??
    (typeof window === "undefined" ? undefined : window.screen?.orientation?.type);
  if (orientationType !== undefined) {
    return orientationType.includes("portrait");
  }

  const degrees =
    environment?.orientationDegrees ??
    (typeof window === "undefined"
      ? undefined
      : (window as unknown as { orientation?: number }).orientation);
  return degrees === 0 || degrees === 180;
}

/**
 * 移动端竖屏时返回转置后的宽高，其余情况原样返回。
 */
export function rtcOrientedVideoSize(
  size: { width: number; height: number },
  environment?: RtcOrientationEnvironment,
): { width: number; height: number } {
  return shouldTransposeRtcVideoSize(environment)
    ? { width: size.height, height: size.width }
    : size;
}
