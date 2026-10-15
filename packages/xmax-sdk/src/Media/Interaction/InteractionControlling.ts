import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { InteractionFrame } from "./InteractionFrame";

/**
 * 提交当前任务的模型像素坐标；由 Core 装配到 Stream 层。
 */
export type InteractionListener = (taskID: string, points: RealtimePoint[]) => Promise<void>;

/**
 * 生成任务的交互上下文及采样入口。
 */
export interface InteractionControlling {
  /**
   * 激活任务或更新输入格式；使旧任务的待发送采样失效。
   */
  startInteraction(taskID: string, videoFormat: RealtimeVideoFormat): void;
  /**
   * 停用交互并丢弃待发送采样。
   */
  stopInteraction(): void;
  /**
   * 提交视口采样；无活动任务时忽略。
   */
  submitInteraction(frame: InteractionFrame): void;
}
