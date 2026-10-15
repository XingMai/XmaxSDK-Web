import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { InteractionCoordinateMapper } from "./InteractionCoordinateMapper";
import type { InteractionFrame } from "./InteractionFrame";
import type { InteractionControlling, InteractionListener } from "./InteractionControlling";

/**
 * 将视口采样转换为模型坐标，串行提交且只保留最新待发送帧。
 */
export class InteractionController implements InteractionControlling {
  /**
   * 活动任务与待发送采样；上下文对象身份隔离任务切换。
   */
  private active?: { taskID: string; videoFormat: RealtimeVideoFormat };
  private pending?: { context: NonNullable<InteractionController["active"]>; points: RealtimePoint[] };
  private draining?: NonNullable<InteractionController["active"]>;

  /**
   * 注入发送能力，不持有房间或具体 RTC。
   */
  constructor(private readonly listener: InteractionListener) {}

  /**
   * 激活或更新任务输入格式，清除旧采样。
   */
  startInteraction(taskID: string, videoFormat: RealtimeVideoFormat): void {
    this.stopInteraction();
    if (taskID) {
      this.active = { taskID, videoFormat };
    }
  }

  /**
   * 立即使交互上下文失效；已提交给 RTC 的消息无法撤回。
   */
  stopInteraction(): void {
    this.active = undefined;
    this.pending = undefined;
    this.draining = undefined;
  }

  /**
   * 同步转换数据，发送忙时用最新采样覆盖旧采样，避免弱网积压。
   */
  submitInteraction(frame: InteractionFrame): void {
    const context = this.active;
    if (!context) {
      return;
    }

    const points = frame.points.flatMap(point => {
      const mapped = InteractionCoordinateMapper.map(point, frame, context.videoFormat);
      return mapped ? [mapped] : [];
    });
    if (!points.length) {
      return;
    }

    this.pending = { context, points };
    if (this.draining !== context) {
      void this.drain(context);
    }
  }

  /**
   * 顺序发送；失败只丢弃当前帧，不终止生成或阻止后续交互。
   */
  private async drain(context: NonNullable<InteractionController["active"]>): Promise<void> {
    this.draining = context;
    try {
      while (this.active === context && this.pending?.context === context) {
        const { points } = this.pending;
        this.pending = undefined;
        try {
          await this.listener(context.taskID, points);
        } catch {
          if (context === this.active) {
            XmaxLogger.interaction.warning(() => "发送交互轨迹失败，已丢弃当前采样帧 (Interaction Sample Dropped)");
          }
        }
      }
    } finally {
      if (this.draining === context) {
        this.draining = undefined;
      }
    }
  }
}
