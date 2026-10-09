import { XmaxLogger, XmaxLoggerOption } from "../../Foundation/Logging/XmaxLogger";
import type { VideoRenderStatistics } from "./VideoRenderStatistics";

/**
 * 单个视频视图的呈现统计采集器，管理帧观察、采样窗口、统计回调和日志。
 * 不控制视频播放或插帧，仅观察原视频帧与画布呈现提交。 @internal
 */
export class RenderStatisticsController {
  /**
   * 统计回调
   */
  handler?: (statistics?: VideoRenderStatistics) => void;

  /**
   * 帧观察与采样生命周期
   */
  private timer?: ReturnType<typeof setInterval>;
  private callbackID?: number;
  private sequence = 0;

  /**
   * 采样窗口与输出方式
   */
  private startedAt = 0;
  private originalFrames = 0;
  private interpolatedFrames = 0;
  private interpolationActive = false;

  /**
   * 绑定用于观察原视频帧的元素，调用 start 后才开始采集。
   */
  constructor(private readonly video: HTMLVideoElement) {}

  /**
   * 独立于统计面板可见性采集；没有监听者且未开启性能日志时不占用定时器。
   */
  start(): void {
    if (this.timer !== undefined ||
        (!this.video.srcObject && !this.video.getAttribute("src")) ||
        (!this.handler && !XmaxLogger.isEnabled(XmaxLoggerOption.performance)) ||
        typeof this.video.requestVideoFrameCallback !== "function") {
      return;
    }

    this.reset();
    const sequence = this.sequence;
    const observe = () => {
      this.callbackID = this.video.requestVideoFrameCallback(() => {
        if (sequence !== this.sequence) {
          return;
        }
        this.callbackID = undefined;
        if (!this.interpolationActive && !document.hidden) {
          this.originalFrames++;
        }
        observe();
      });
    };
    observe();
    this.timer = setInterval(() => this.sample(), 1_000);
  }

  /**
   * 切换输出方式并清空采样窗口，避免原视频和画布重复计数。
   */
  setInterpolationActive(active: boolean): void {
    this.interpolationActive = active;
    this.reset();
  }

  /**
   * 记录实际提交到画布的原帧或插值帧，不统计未呈现的计算结果。
   */
  recordCanvasFrame(interpolated: boolean): void {
    if (interpolated) {
      this.interpolatedFrames++;
    } else {
      this.originalFrames++;
    }
  }

  /**
   * 取消采样及帧观察，忽略已排队的旧回调并清空对外统计。
   */
  stop(): void {
    this.sequence++;
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.callbackID !== undefined) {
      this.video.cancelVideoFrameCallback(this.callbackID);
    }
    this.callbackID = undefined;
    this.reset();
  }

  /**
   * 清空采样计数，避免换流或切换输出方式时混入旧数据。
   */
  private reset(): void {
    this.startedAt = performance.now();
    this.originalFrames = 0;
    this.interpolatedFrames = 0;
    this.notify(undefined);
  }

  /**
   * 按实际经过的时间计算帧率；没有新呈现时输出 0，后台页面不报告帧率。
   */
  private sample(): void {
    const now = performance.now();
    const seconds = (now - this.startedAt) / 1000;
    if (document.hidden || seconds <= 0) {
      this.reset();
      return;
    }

    const statistics: VideoRenderStatistics = Object.freeze({
      source: this.interpolationActive ? "canvas" : "video",
      frameRate: (this.originalFrames + this.interpolatedFrames) / seconds,
      originalFrameRate: this.originalFrames / seconds,
      interpolatedFrameRate: this.interpolatedFrames / seconds,
    });
    this.startedAt = now;
    this.originalFrames = 0;
    this.interpolatedFrames = 0;
    this.notify(statistics);
    XmaxLogger.render.info(() => `渲染帧率 (Render Frame Rate)\n` +
      `├─ source: ${statistics.source}, fps: ${statistics.frameRate.toFixed(1)}\n` +
      `└─ original: ${statistics.originalFrameRate.toFixed(1)} fps, interpolated: ${statistics.interpolatedFrameRate.toFixed(1)} fps`,
    XmaxLoggerOption.performance);
  }

  /**
   * 隔离接入方回调异常，避免影响播放和后续采样。
   */
  private notify(statistics?: VideoRenderStatistics): void {
    try {
      this.handler?.(statistics);
    } catch {}
  }
}
