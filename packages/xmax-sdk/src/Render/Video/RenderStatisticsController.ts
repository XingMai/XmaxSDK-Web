import type { VideoRenderStatistics } from "./VideoRenderStatistics";

/**
 * 单个视频视图的呈现统计采集器，管理帧观察、采样窗口和统计回调。
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
  private previousPresentedFrames?: number;

  /**
   * 绑定用于观察原视频帧的元素，调用 start 后才开始采集。
   */
  constructor(private readonly video: HTMLVideoElement) {}

  /**
   * 独立于统计面板可见性采集；没有监听者时不占用定时器。
   */
  start(): void {
    if (this.timer !== undefined ||
        (!this.video.srcObject && !this.video.getAttribute("src")) ||
        !this.handler ||
        typeof this.video.requestVideoFrameCallback !== "function") {
      return;
    }

    this.reset();
    const sequence = this.sequence;
    const observe = () => {
      this.callbackID = this.video.requestVideoFrameCallback((_now, metadata) => {
        if (sequence !== this.sequence) {
          return;
        }
        this.callbackID = undefined;
        if (!this.interpolationActive && !document.hidden) {
          this.recordVideoFrames(metadata.presentedFrames);
        } else {
          // 画布接管或页面隐藏期间的原视频帧不归入后续可见窗口。
          this.previousPresentedFrames = undefined;
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
   * 按浏览器累计呈现帧数的增量统计，包含两次回调之间已呈现但未回调的帧。
   */
  private recordVideoFrames(presentedFrames: number): void {
    if (!Number.isSafeInteger(presentedFrames) || presentedFrames < 0) {
      this.previousPresentedFrames = undefined;
      return;
    }

    const previous = this.previousPresentedFrames;
    this.previousPresentedFrames = presentedFrames;

    // 首次观察或计数回退时只计当前帧，不能把此前播放的累计帧数加进来。
    if (previous === undefined || presentedFrames < previous) {
      this.originalFrames += presentedFrames > 0 ? 1 : 0;
      return;
    }

    this.originalFrames += presentedFrames - previous;
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
    this.previousPresentedFrames = undefined;
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
