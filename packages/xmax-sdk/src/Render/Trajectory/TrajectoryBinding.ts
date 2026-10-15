import type { InteractionFrame } from "../../Media/Interaction/InteractionFrame";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { TrajectoryOverlayView } from "./TrajectoryOverlayView";

/**
 * 远端轨道的交互绑定，向视图传递格式和任务可用性，不持有任务 ID。
 */
export class TrajectoryBinding {
  /**
   * 绑定视图与可用性
   */
  private overlay?: TrajectoryOverlayView;
  private enabled = false;
  private valid = true;

  /**
   * 注入采样回调及模型输入格式，不引用 Media Controller 实例。
   */
  constructor(private readonly listener: (frame: InteractionFrame) => void, private format: RealtimeVideoFormat) {}

  /**
   * 一个远端绑定只由一个交互视图持有，迁移时取消旧视图的触点。
   */
  attach(overlay: TrajectoryOverlayView): void {
    if (!this.valid) {
      return;
    }
    if (this.overlay !== overlay) {
      this.overlay?.setBinding(undefined);
    }
    this.overlay = overlay;
    overlay.setBinding(this, this.format, this.enabled);
  }

  /**
   * 只解除当前所有者，旧视图迟到的 detach 不影响新视图。
   */
  detach(overlay: TrajectoryOverlayView): void {
    if (this.overlay === overlay) {
      this.overlay = undefined;
      overlay.setBinding(undefined);
    }
  }

  /**
   * 开始、更新或结束任务时同步交互能力，并取消旧手势。
   */
  update(enabled: boolean, format = this.format): void {
    this.enabled = enabled;
    this.format = format;
    this.overlay?.setBinding(this, format, enabled);
  }

  /**
   * 转发当前视图采样；注销或停用后忽略。
   */
  submit(frame: InteractionFrame): void {
    if (this.valid && this.enabled) {
      this.listener(frame);
    }
  }

  /**
   * 注销绑定并释放视图交互资源，不允许旧引用重新挂载。
   */
  invalidate(): void {
    this.valid = false;
    this.overlay?.setBinding(undefined);
    this.overlay = undefined;
  }
}
