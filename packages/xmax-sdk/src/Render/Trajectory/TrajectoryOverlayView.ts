import { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { InteractionCoordinateMapper } from "../../Media/Interaction/InteractionCoordinateMapper";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { TrajectoryBinding } from "./TrajectoryBinding";
import type { TrajectoryEffectRendering } from "./TrajectoryEffectRendering";
import type { TrajectoryPoint } from "./TrajectoryPoint";

/**
 * 采集鼠标、触屏和触控笔输入，驱动效果并以约 30Hz 提交视口采样。
 */
export class TrajectoryOverlayView {
  /**
   * 视图与显示配置
   */
  readonly element = document.createElement("div");
  private binding?: TrajectoryBinding;
  private format?: RealtimeVideoFormat;
  private contentMode = VideoContentMode.fill;
  private mirrored = false;
  private requested = true;
  private enabled = false;

  /**
   * 手势采样与生命周期资源
   */
  private readonly pointers = new Map<number, TrajectoryPoint>();
  private nextID = 0;
  private animation?: number;
  private lastSample = 0;
  private resizeObserver?: ResizeObserver;
  private viewport?: { width: number; height: number };
  private readonly visibilityChanged = () => {
    if (document.hidden) {
      this.cancel();
    }
    this.updateStyle();
  };
  private readonly onDown = (event: PointerEvent) => this.begin(event);
  private readonly onMove = (event: PointerEvent) => this.move(event);
  private readonly onEnd = (event: PointerEvent) => this.end(event.pointerId);

  /**
   * 安装透明交互层及独立 Renderer；只有任务就绪时接管指针。
   */
  constructor(private readonly renderer: TrajectoryEffectRendering) {
    Object.assign(this.element.style, { position: "absolute", inset: "0", zIndex: "2", overflow: "hidden" });
    Object.assign(renderer.element.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
    this.element.appendChild(renderer.element);
    this.element.addEventListener("pointerdown", this.onDown);
    this.element.addEventListener("pointermove", this.onMove);
    this.element.addEventListener("pointerup", this.onEnd);
    this.element.addEventListener("pointercancel", this.onEnd);
    this.element.addEventListener("lostpointercapture", this.onEnd);
    document.addEventListener("visibilitychange", this.visibilityChanged);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.cancel());
      this.resizeObserver.observe(this.element);
    }
    this.updateStyle();
  }

  /**
   * 更新任务绑定，清除旧任务手势和采样。
   */
  setBinding(binding?: TrajectoryBinding, format?: RealtimeVideoFormat, enabled = false): void {
    this.cancel();
    this.binding = binding;
    this.format = format;
    this.enabled = enabled;
    this.updateStyle();
  }

  /**
   * 同步显示配置；配置变化后旧坐标不再继续发送。
   */
  configure(mode: VideoContentMode, mirrored: boolean, enabled: boolean): void {
    if (this.contentMode !== mode || this.mirrored !== mirrored || this.requested !== enabled) {
      this.cancel();
    }
    this.contentMode = mode;
    this.mirrored = mirrored;
    this.requested = enabled;
    this.updateStyle();
  }

  /**
   * 卸载时取消采样、动画、捕获和事件监听；Renderer 可以再次挂载。
   */
  dispose(): void {
    this.binding?.detach(this);
    this.cancel();
    this.resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.element.removeEventListener("pointerdown", this.onDown);
    this.element.removeEventListener("pointermove", this.onMove);
    this.element.removeEventListener("pointerup", this.onEnd);
    this.element.removeEventListener("pointercancel", this.onEnd);
    this.element.removeEventListener("lostpointercapture", this.onEnd);
    this.element.remove();
  }

  /**
   * 无任务或被禁用时不阻止页面滚动。
   */
  private updateStyle(): void {
    const active = this.requested && this.enabled && !!this.binding && !document.hidden;
    this.element.style.pointerEvents = active ? "auto" : "none";
    this.element.style.touchAction = active ? "none" : "auto";
    this.element.style.userSelect = active ? "none" : "auto";
  }

  /**
   * 根据实际显示区域拒绝黑边，移动到视口外时限制在可见视频边缘。
   */
  private point(event: PointerEvent, id: number, clamp: boolean): TrajectoryPoint | undefined {
    const viewport = this.element.getBoundingClientRect();
    if (!this.format) {
      return undefined;
    }
    const rect = InteractionCoordinateMapper.displayedFrame(viewport, this.format, this.contentMode);
    if (!rect || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return undefined;
    }
    const minX = Math.max(0, rect.x);
    const minY = Math.max(0, rect.y);
    const maxX = Math.min(viewport.width, rect.x + rect.width);
    const maxY = Math.min(viewport.height, rect.y + rect.height);
    let x = event.clientX - viewport.left;
    let y = event.clientY - viewport.top;
    if (!clamp && (x < minX || x > maxX || y < minY || y > maxY)) {
      return undefined;
    }
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
    return Object.freeze({
      id,
      location: Object.freeze({ x, y }),
      normalizedLocation: Object.freeze({ x: (x - rect.x) / rect.width, y: (y - rect.y) / rect.height }),
      timestamp: performance.now(),
    });
  }

  /**
   * 按下立即采样，不等待定时窗口；只接受鼠标主键。
   */
  private begin(event: PointerEvent): void {
    if (!this.requested || !this.enabled || !this.binding || document.hidden || event.button !== 0) {
      return;
    }
    const point = this.point(event, ++this.nextID, false);
    if (!point) {
      return;
    }
    event.preventDefault();
    this.pointers.set(event.pointerId, point);
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // 指针可能已被浏览器取消；仍由 pointercancel 或视图卸载结束手势。
    }
    this.render(() => this.renderer.renderBegan([point]));
    this.sample(performance.now(), true);
    this.schedule();
  }

  /**
   * 高频指针事件只更新最新位置及视觉效果，不直接发送网络消息。
   */
  private move(event: PointerEvent): void {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      return;
    }
    const point = this.point(event, previous.id, true);
    if (point) {
      this.pointers.set(event.pointerId, point);
      this.render(() => this.renderer.renderMoved([point]));
    }
  }

  /**
   * 释放单个指针，多指交互继续；最后一个指针释放后停止采样。
   */
  private end(pointerID: number): void {
    const point = this.pointers.get(pointerID);
    if (!point) {
      return;
    }
    this.pointers.delete(pointerID);
    try {
      this.element.releasePointerCapture(pointerID);
    } catch {
      // 浏览器可能已在 pointerup 或取消事件中释放捕获。
    }
    this.render(() => this.renderer.renderEnded([point.id]));
    if (!this.pointers.size) {
      this.stopSampling();
    }
  }

  /**
   * 取消全部手势及视觉效果，不保留跨生命周期轨迹。
   */
  private cancel(): void {
    for (const id of [...this.pointers.keys()]) {
      this.end(id);
    }
    this.stopSampling();
    this.render(() => this.renderer.reset());
  }

  /**
   * 清理采样回调与视口快照。
   */
  private stopSampling(): void {
    if (this.animation !== undefined) {
      cancelAnimationFrame(this.animation);
    }
    this.animation = undefined;
    this.viewport = undefined;
    this.lastSample = 0;
  }

  /**
   * 只在存在活动触点时运行动画时钟。
   */
  private schedule(): void {
    if (this.animation === undefined && this.pointers.size) {
      this.animation = requestAnimationFrame(now => {
        this.animation = undefined;
        this.sample(now);
        this.schedule();
      });
    }
  }

  /**
   * 固定频率发送所有活动触点的快照，布局变化时取消而非发送旧坐标。
   */
  private sample(now: number, force = false): void {
    if (document.hidden) {
      this.cancel();
      return;
    }
    const { width, height } = this.element.getBoundingClientRect();
    if (this.viewport && (width !== this.viewport.width || height !== this.viewport.height)) {
      this.cancel();
      return;
    }
    this.viewport = { width, height };
    if (!force && now - this.lastSample < 1000 / 30) {
      return;
    }
    this.lastSample = now;
    this.binding?.submit({
      points: [...this.pointers.values()].map(point => point.location),
      viewportSize: this.viewport,
      contentMode: this.contentMode,
      mirrored: this.mirrored,
    });
  }

  /**
   * 自定义效果异常不影响触点采集和网络发送。
   */
  private render(action: () => void): void {
    try {
      action();
    } catch {
      XmaxLogger.render.warning(() => "轨迹效果绘制失败 (Trajectory Rendering Failed)");
    }
  }
}
