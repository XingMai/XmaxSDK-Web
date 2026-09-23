import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { XmaxLogger } from "../../Logging/XmaxLogger";

/**
 * 仅供不支持视频帧回调的浏览器使用；正常路径逐帧检测，无采样限流。
 */
const FALLBACK_POLL_INTERVAL_MS = 16;
const TIMEOUT_MS = 2_000;

/**
 * 启动曝光的保守启发式检查，不代表硬件自动曝光状态或画面质量评分。
 */
export class CameraFrameValidator {
  /**
   * 单帧中央区域亮度达标即放行，不等待连续帧或曝光稳定。
   */
  accept(pixels: Uint8ClampedArray): boolean {
    const size = pixels.length / 4;
    if (!size || !Number.isInteger(size)) return false;

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
    return mean >= 24 && median >= 18 && dark / size <= 0.75;
  }
}

/**
 * 等待首张合格帧，超时则降级放行；不保存图像、不调整亮度、不停止原始轨道。
 */
export function waitForValidCameraFrame(track: MediaStreamTrack, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let video: HTMLVideoElement | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let frameCallback: number | undefined;
    let finished = false;
    const started = performance.now();
    const gate = new CameraFrameValidator();

    // 所有结束路径共用清理入口，先释放检测资源，再通知等待方。
    const finish = (result: "valid" | "timeout" | XmaxError = "valid") => {
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

      if (result instanceof XmaxError) {
        if (result.code !== XmaxErrorCode.cancelled) XmaxLogger.media.warning(() => result.message);
        reject(result);
      } else {
        if (result === "timeout") {
          XmaxLogger.media.warning(() => XmaxLogger.localized(
            "相机亮度检查超时，按当前画面继续生成 (Camera Frame Validation Timed Out; Continuing)\n└─ 未获得亮度合格帧，不再等待。",
            "Camera Frame Validation Timed Out; Continuing\n└─ No sufficiently bright frame received; proceeding without further waiting.",
          ));
        } else {
          XmaxLogger.media.info(() =>
            `相机曝光检查通过 (Camera Exposure Ready)\n└─ ${Math.round(performance.now() - started)} ms`);
        }
        resolve();
      }
    };

    const abort = () => finish(new XmaxError(XmaxErrorCode.cancelled, "Camera exposure check cancelled"));
    const ended = () => finish(new XmaxError(XmaxErrorCode.mediaError, "Camera track ended before exposure was ready"));
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

      // 只采样新的视频帧，并使用中央区域判断亮度。
      const source = video;
      let lastFrameTime = -Infinity;
      const sample = (mediaTime: number) => {
        if (source.readyState < 2 || !source.videoWidth || !source.videoHeight || track.muted || !track.enabled) {
          return;
        }
        if (mediaTime === lastFrameTime) return;
        lastFrameTime = mediaTime;

        const width = source.videoWidth;
        const height = source.videoHeight;
        context.drawImage(source, width * 0.2, height * 0.2, width * 0.6, height * 0.6, 0, 0, 64, 48);
        if (gate.accept(context.getImageData(0, 0, 64, 48).data)) finish();
      };

      const fail = (error: unknown) => finish(new XmaxError(XmaxErrorCode.mediaError,
        `Camera exposure check failed: ${error instanceof Error ? error.message : String(error)}`));
      const schedule = () => {
        if (finished) return;

        if (typeof source.requestVideoFrameCallback === "function") {
          frameCallback = source.requestVideoFrameCallback((_now, metadata) => {
            frameCallback = undefined;

            try {
              sample(metadata.mediaTime);
              schedule();
            } catch (error) {
              fail(error);
            }
          });
        } else {
          poll = setTimeout(() => {
            try {
              // 优先用呈现帧计数，防止播放时钟继续走、视频却没有新帧。
              const frameTime = typeof source.getVideoPlaybackQuality === "function"
                ? source.getVideoPlaybackQuality().totalVideoFrames
                : source.currentTime;
              sample(frameTime);
              schedule();
            } catch (error) {
              fail(error);
            }
          }, FALLBACK_POLL_INTERVAL_MS);
        }
      };

      timeout = setTimeout(() => finish("timeout"), TIMEOUT_MS);
      XmaxLogger.media.info(() => "等待首张亮度合格帧 (Waiting for the First Sufficiently Bright Frame)");
      void source.play().then(schedule, fail);
    } catch (error) {
      finish(new XmaxError(XmaxErrorCode.mediaError,
        `Camera exposure check failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}
