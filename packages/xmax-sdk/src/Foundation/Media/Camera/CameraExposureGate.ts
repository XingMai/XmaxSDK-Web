import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { XmaxLogger } from "../../Logging/XmaxLogger";

const SAMPLE_INTERVAL_MS = 80;
const STABLE_DURATION_MS = 400;
const TIMEOUT_MS = 5_000;

/** 启动曝光的保守启发式检查，不代表硬件自动曝光状态或画面质量评分。 */
export class CameraExposureGate {
  private baseline?: { mean: number; median: number; time: number };
  private lastTime?: number;
  private count = 0;

  reset(): void {
    this.baseline = undefined;
    this.lastTime = undefined;
    this.count = 0;
  }

  /** 只接受新的采样帧；中央区域需足够亮，并在至少 400 ms 内保持稳定。 */
  accept(pixels: Uint8ClampedArray, time: number): boolean {
    const size = pixels.length / 4;
    if (!size || !Number.isInteger(size)) { this.reset(); return false; }
    const histogram = new Uint32Array(256);
    let total = 0;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = Math.round(0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!);
      histogram[luminance] = histogram[luminance]! + 1;
      total += luminance;
      if (luminance < 12) dark++;
    }
    let median = 0;
    let accumulated = 0;
    for (; median < 255; median++) {
      accumulated += histogram[median]!;
      if (accumulated >= size / 2) break;
    }
    const mean = total / size;
    // 中位数和暗像素比例防止少量高亮灯光掩盖中央主体欠曝。
    if (mean < 24 || median < 18 || dark / size > 0.75) {
      this.reset();
      return false;
    }
    const baseline = this.baseline;
    const stable = baseline && this.lastTime !== undefined &&
      time > this.lastTime && time - this.lastTime <= 250 &&
      Math.abs(mean - baseline.mean) <= Math.max(5, baseline.mean * 0.1) &&
      Math.abs(median - baseline.median) <= Math.max(5, baseline.median * 0.1);
    if (!stable) {
      this.baseline = { mean, median, time };
      this.count = 0;
    }
    this.lastTime = time;
    this.count++;
    return this.count >= 5 && time - this.baseline!.time >= STABLE_DURATION_MS;
  }
}

/** 独立于可见预览读取采集轨；不保存图像，不调整亮度，也不停止原始轨道。 */
export function waitForCameraExposure(track: MediaStreamTrack, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let video: HTMLVideoElement | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let frameCallback: number | undefined;
    let finished = false;
    const started = performance.now();
    const gate = new CameraExposureGate();
    const finish = (error?: XmaxError) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(poll);
      if (video) {
        if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
        video.pause();
        video.srcObject = null;
        video.remove();
      }
      signal.removeEventListener("abort", abort);
      track.removeEventListener("ended", ended);
      if (error) {
        if (error.code !== XmaxErrorCode.cancelled) XmaxLogger.media.warning(() => error.message);
        reject(error);
      } else {
        XmaxLogger.media.info(() =>
          `相机曝光检查通过 (Camera Exposure Ready)\n└─ ${Math.round(performance.now() - started)} ms`);
        resolve();
      }
    };
    const abort = () => finish(new XmaxError(XmaxErrorCode.cancelled, "Camera exposure check cancelled"));
    const ended = () => finish(new XmaxError(XmaxErrorCode.mediaError, "Camera track ended before exposure was ready"));
    signal.addEventListener("abort", abort, { once: true });
    track.addEventListener("ended", ended, { once: true });
    if (signal.aborted) { abort(); return; }
    if (track.readyState === "ended") { ended(); return; }

    try {
      video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("aria-hidden", "true");
      // 保持可渲染以获取帧回调；不能依赖尚未挂载的接入方预览。
      video.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 48;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Camera exposure sampling requires a 2D canvas");
      video.srcObject = new MediaStream([track]);
      document.body.appendChild(video);
      const source = video;
      let lastSample = -Infinity;
      let lastFrameTime = -Infinity;
      const sample = (now: number, mediaTime: number) => {
        if (now - lastSample < SAMPLE_INTERVAL_MS) return;
        if (source.readyState < 2 || !source.videoWidth || !source.videoHeight || track.muted || !track.enabled) {
          gate.reset();
          return;
        }
        if (mediaTime === lastFrameTime) return;
        lastSample = now;
        lastFrameTime = mediaTime;
        const width = source.videoWidth;
        const height = source.videoHeight;
        context.drawImage(source, width * 0.2, height * 0.2, width * 0.6, height * 0.6, 0, 0, 64, 48);
        if (gate.accept(context.getImageData(0, 0, 64, 48).data, now)) finish();
      };
      const fail = (error: unknown) => finish(new XmaxError(XmaxErrorCode.mediaError,
        `Camera exposure check failed: ${error instanceof Error ? error.message : String(error)}`));
      const schedule = () => {
        if (finished) return;
        if (typeof source.requestVideoFrameCallback === "function") {
          frameCallback = source.requestVideoFrameCallback((now, metadata) => {
            frameCallback = undefined;
            try { sample(now, metadata.mediaTime); schedule(); } catch (error) { fail(error); }
          });
        } else {
          poll = setTimeout(() => {
            try {
              // 优先用呈现帧计数，防止播放时钟继续走、视频却没有新帧。
              const frameTime = typeof source.getVideoPlaybackQuality === "function"
                ? source.getVideoPlaybackQuality().totalVideoFrames
                : source.currentTime;
              sample(performance.now(), frameTime);
              schedule();
            } catch (error) { fail(error); }
          }, SAMPLE_INTERVAL_MS);
        }
      };
      timeout = setTimeout(() => finish(new XmaxError(XmaxErrorCode.cameraExposureTimeout,
        XmaxLogger.localized(
          "相机画面过暗或尚未稳定，未发布视频。请改善光照后重试。",
          "Camera frames are too dark or not stable. Video was not published. Improve lighting and retry.",
        ))), TIMEOUT_MS);
      XmaxLogger.media.info(() => "等待相机曝光稳定 (Waiting for Camera Exposure)");
      void source.play().then(schedule, fail);
    } catch (error) {
      finish(new XmaxError(XmaxErrorCode.mediaError,
        `Camera exposure check failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}
