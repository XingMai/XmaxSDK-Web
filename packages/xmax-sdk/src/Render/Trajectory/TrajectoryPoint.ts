/**
 * 单次按下到释放期间稳定的轨迹标识，不依赖浏览器复用的 pointerId。
 */
export type TrajectoryID = number;

/**
 * 供视觉效果使用的触点；location 为视口 CSS 像素，timestamp 为毫秒。
 */
export interface TrajectoryPoint {
  readonly id: TrajectoryID;
  readonly location: Readonly<{ x: number; y: number }>;
  readonly normalizedLocation: Readonly<{ x: number; y: number }>;
  readonly timestamp: number;
}
