import type { TrajectoryID, TrajectoryPoint } from "./TrajectoryPoint";

/**
 * 可替换的轨迹视觉效果；不参与触点采样、坐标转换或网络发送。
 * 一个实例仅供一个视图使用，reset 必须释放动画和清空轨迹。
 */
export interface TrajectoryEffectRendering {
  /**
   * 安装在交互层中的元素；SDK 禁用该元素的指针事件。
   */
  readonly element: HTMLElement;
  /**
   * 绘制新轨迹。
   */
  renderBegan(points: readonly TrajectoryPoint[]): void;
  /**
   * 更新已有轨迹。
   */
  renderMoved(points: readonly TrajectoryPoint[]): void;
  /**
   * 结束轨迹，可继续播放淡出效果。
   */
  renderEnded(identifiers: readonly TrajectoryID[]): void;
  /**
   * 清除全部轨迹并取消动画；实例仍可再次使用。
   */
  reset(): void;
}
