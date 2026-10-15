import type { TrajectoryEffectRendering } from "./TrajectoryEffectRendering";
import type { TrajectoryID, TrajectoryPoint } from "./TrajectoryPoint";

/**
 * 轨迹外晕、中层、白色线芯及触点装饰的 CSS 像素规格。
 */
const VISUAL = {
  outerWidth: 18, outerBlur: 12, outerAlpha: 0.35,
  middleWidth: 10, middleBlur: 6, middleAlpha: 0.75,
  coreWidth: 3,
  headRadius: 5, headGlowRadius: 14, headGlowAlpha: 0.9,
  ringCount: 2, ringStartRadius: 10, ringSpacing: 14,
  ringLineWidth: 2, ringPulseSpeed: 1.2, ringMaxAlpha: 0.6,
  particleCount: 4, particleRadius: 3, particleOrbitRadius: 22,
  particleSpeed: 0.06, particleAlpha: 0.6,
  fadeAlpha: 0.05, idleFadeFrames: 64,
} as const;

/**
 * 绿色发光尾迹与触点装饰；仅负责绘制，不参与采样或信令发送。
 */
export class DefaultTrajectoryEffectRenderer implements TrajectoryEffectRendering {
  /**
   * 画布与动画资源；尾迹保留像素渐隐，触点装饰每帧重绘。
   */
  readonly element = document.createElement("div");
  private readonly trailCanvas = document.createElement("canvas");
  private readonly effectCanvas = document.createElement("canvas");
  private animation?: number;
  private hasTrailPixels = false;
  private idleFadeFrames = 0;

  /**
   * 活动触点和等待下一帧绘制的线段。
   */
  private readonly pointers = new Map<TrajectoryID, { point: TrajectoryPoint; startedAt: number }>();
  private readonly segments: Array<{ from: TrajectoryPoint; to: TrajectoryPoint }> = [];

  /**
   * 安装独立视觉图层，不注册指针事件。
   */
  constructor() {
    for (const canvas of [this.trailCanvas, this.effectCanvas]) {
      Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
      this.element.appendChild(canvas);
    }
  }

  /**
   * 开始触点装饰，脉冲动画以本次按下时间为起点。
   */
  renderBegan(points: readonly TrajectoryPoint[]): void {
    for (const point of points) {
      this.pointers.set(point.id, { point, startedAt: point.timestamp });
    }
    this.idleFadeFrames = 0;
    this.schedule();
  }

  /**
   * 只绘制新线段，旧像素自然衰减，不反复加亮整条历史轨迹。
   */
  renderMoved(points: readonly TrajectoryPoint[]): void {
    for (const point of points) {
      const pointer = this.pointers.get(point.id);
      if (pointer) {
        this.segments.push({ from: pointer.point, to: point });
        pointer.point = point;
      }
    }
    this.schedule();
  }

  /**
   * 释放触点后移除装饰，仅保留尾迹的渐隐动画。
   */
  renderEnded(identifiers: readonly TrajectoryID[]): void {
    for (const id of identifiers) {
      this.pointers.delete(id);
    }
    this.schedule();
  }

  /**
   * 清除画面、待绘制数据及动画，允许同一 Renderer 再次挂载。
   */
  reset(): void {
    if (this.animation !== undefined) {
      cancelAnimationFrame(this.animation);
    }
    this.animation = undefined;
    this.pointers.clear();
    this.segments.length = 0;
    this.hasTrailPixels = false;
    this.idleFadeFrames = 0;
    for (const canvas of [this.trailCanvas, this.effectCanvas]) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  /**
   * 仅在触点、待绘制线段或残留尾迹存在时申请下一帧。
   */
  private schedule(): void {
    if (this.animation === undefined && (this.pointers.size || this.segments.length || this.hasTrailPixels)) {
      this.animation = requestAnimationFrame(now => this.draw(now));
    }
  }

  /**
   * 同步画布分辨率，分别更新尾迹和触点视觉图层。
   */
  private draw(now: number): void {
    this.animation = undefined;
    const trail = this.trailCanvas.getContext("2d");
    const effects = this.effectCanvas.getContext("2d");
    if (!trail || !effects) {
      this.reset();
      return;
    }

    const rect = this.element.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    for (const canvas of [this.trailCanvas, this.effectCanvas]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        this.hasTrailPixels = false;
      }
    }

    if (this.hasTrailPixels) {
      trail.save();
      trail.globalCompositeOperation = "destination-out";
      trail.fillStyle = "rgba(0,0,0," + VISUAL.fadeAlpha + ")";
      trail.fillRect(0, 0, width, height);
      trail.restore();
    }
    if (this.segments.length) {
      this.drawSegments(trail, dpr);
      this.segments.length = 0;
      this.hasTrailPixels = true;
      this.idleFadeFrames = 0;
    }

    effects.clearRect(0, 0, width, height);
    effects.save();
    effects.globalCompositeOperation = "lighter";
    for (const { point, startedAt } of this.pointers.values()) {
      const x = point.location.x * dpr;
      const y = point.location.y * dpr;
      if (this.pointers.size === 1) {
        this.drawRings(effects, x, y, dpr, (now - startedAt) / 1000);
        this.drawParticles(effects, x, y, dpr, (now - startedAt) / 1000);
      }
      this.drawGlow(effects, x, y, VISUAL.headGlowRadius * dpr, VISUAL.headGlowAlpha, true);
      effects.fillStyle = "rgba(255,255,255,1)";
      effects.beginPath();
      effects.arc(x, y, VISUAL.headRadius * dpr, 0, Math.PI * 2);
      effects.fill();
    }
    effects.restore();

    if (this.pointers.size) {
      this.idleFadeFrames = 0;
    } else if (this.hasTrailPixels && ++this.idleFadeFrames > VISUAL.idleFadeFrames) {
      trail.clearRect(0, 0, width, height);
      this.hasTrailPixels = false;
      this.idleFadeFrames = 0;
    }
    this.schedule();
  }

  /**
   * 叠加绿色外晕、中层和白色线芯；多指时省略阴影降低绘制开销。
   */
  private drawSegments(context: CanvasRenderingContext2D, dpr: number): void {
    const layers = [
      { width: VISUAL.outerWidth, blur: VISUAL.outerBlur, color: this.green(VISUAL.outerAlpha) },
      { width: VISUAL.middleWidth, blur: VISUAL.middleBlur, color: this.green(VISUAL.middleAlpha) },
      { width: VISUAL.coreWidth, blur: 0, color: "rgba(255,255,255,1)" },
    ];
    for (const layer of layers) {
      context.save();
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = layer.width * dpr;
      context.strokeStyle = layer.color;
      context.shadowBlur = this.pointers.size > 1 ? 0 : layer.blur * dpr;
      context.shadowColor = context.shadowBlur ? layer.color : "transparent";
      context.beginPath();
      for (const { from, to } of this.segments) {
        context.moveTo(from.location.x * dpr, from.location.y * dpr);
        context.lineTo(to.location.x * dpr, to.location.y * dpr);
      }
      context.stroke();
      context.restore();
    }
  }

  /**
   * 绘制触点周围两层不同相位的脉冲圆环。
   */
  private drawRings(context: CanvasRenderingContext2D, x: number, y: number, dpr: number, elapsed: number): void {
    context.lineWidth = VISUAL.ringLineWidth * dpr;
    for (let index = 0; index < VISUAL.ringCount; index++) {
      const pulse = (Math.sin((elapsed * VISUAL.ringPulseSpeed + index * 0.5) * Math.PI * 2) + 1) / 2;
      const radius = (VISUAL.ringStartRadius + index * VISUAL.ringSpacing + pulse * 6) * dpr;
      context.strokeStyle = this.green(VISUAL.ringMaxAlpha * (1 - index * 0.2) * (0.5 + pulse * 0.5));
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.stroke();
    }
  }

  /**
   * 绘制四个反向交错运动的柔和环绕粒子。
   */
  private drawParticles(context: CanvasRenderingContext2D, x: number, y: number, dpr: number, elapsed: number): void {
    for (let index = 0; index < VISUAL.particleCount; index++) {
      const direction = index % 2 === 0 ? 1 : -1;
      const angle = index / VISUAL.particleCount * Math.PI * 2 + elapsed * VISUAL.particleSpeed * direction;
      const radius = VISUAL.particleOrbitRadius * dpr;
      const alpha = VISUAL.particleAlpha * (0.6 + Math.sin(elapsed * 3 + index) * 0.4);
      this.drawGlow(context, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, VISUAL.particleRadius * 2 * dpr, alpha);
    }
  }

  /**
   * 绘制径向绿色光晕，触点核心增加中间色阶。
   */
  private drawGlow(context: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number, head = false): void {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, this.green(alpha));
    if (head) {
      gradient.addColorStop(0.4, this.green(alpha * 0.6));
    }
    gradient.addColorStop(1, this.green(0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  /**
   * 统一轨迹主题色，透明度由各视觉层指定。
   */
  private green(alpha: number): string {
    return "rgba(0,255,100," + alpha + ")";
  }
}
