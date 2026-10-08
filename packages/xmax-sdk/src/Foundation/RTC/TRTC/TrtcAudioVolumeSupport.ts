/**
 * TRTC 远端音量控制能力检测的环境参数；缺省时读取浏览器全局对象（可注入，测试用）。
 */
export interface TrtcAudioVolumeEnvironment {
  userAgent?: string;
  maxTouchPoints?: number;
}

/**
 * 判断当前平台是否支持 TRTC 的 `setRemoteAudioVolume` 远端音量控制。
 *
 * iOS Safari 与 WKWebView 不允许 JS 修改媒体元素音量
 * （`HTMLMediaElement.volume` 只读），TRTC 官方亦标注该接口不支持
 * iOS Safari；桌面模式 UA 的 iPad 通过触控点数识别。
 */
export function canControlTrtcRemoteAudioVolume(
  environment?: TrtcAudioVolumeEnvironment,
): boolean {
  const userAgent =
    environment?.userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  const maxTouchPoints =
    environment?.maxTouchPoints ??
    (typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints ?? 0);

  const ios =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  return !ios;
}
