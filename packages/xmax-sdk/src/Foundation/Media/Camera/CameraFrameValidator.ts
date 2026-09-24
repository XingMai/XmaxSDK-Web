import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";

/** 摄像头开启后的固定等待时长：覆盖硬件出帧与曝光爬坡，避免把黑帧推给 RTC。 */
const CAMERA_WARMUP_MS = 200;

/**
 * 等待摄像头进入出帧状态：固定延时，不检测亮度、不保存图像、不停止原始轨道。
 * 取消或轨道结束时立即拒绝，结束后清理全部监听与定时器。
 */
export function waitForValidCameraFrame(track: MediaStreamTrack, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (error?: XmaxError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      track.removeEventListener("ended", ended);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const abort = () => finish(new XmaxError(XmaxErrorCode.cancelled, "Camera warmup cancelled"));
    const ended = () => finish(new XmaxError(XmaxErrorCode.mediaError, "Camera track ended before warmup completed"));

    signal.addEventListener("abort", abort, { once: true });
    track.addEventListener("ended", ended, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    if (track.readyState === "ended") {
      ended();
      return;
    }

    timer = setTimeout(() => finish(), CAMERA_WARMUP_MS);
  });
}
