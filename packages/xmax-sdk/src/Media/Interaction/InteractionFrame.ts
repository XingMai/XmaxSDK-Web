import type { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";

/**
 * 从显示视口采集的交互快照；坐标单位为 CSS 像素，不持有 DOM 事件。
 */
export interface InteractionFrame {
  readonly points: readonly Readonly<{ x: number; y: number }>[];
  readonly viewportSize: Readonly<{ width: number; height: number }>;
  readonly contentMode: VideoContentMode;
  readonly mirrored: boolean;
}
