import { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { InteractionFrame } from "./InteractionFrame";

/**
 * 将视口坐标映射到模型输入像素；不依赖 DOM、设备像素比或 RTC。
 */
export class InteractionCoordinateMapper {
  /**
   * 计算居中显示的视频矩形；fill 允许矩形超出视口，fit 留出黑边。
   */
  static displayedFrame(viewport: { width: number; height: number }, video: { width: number; height: number }, mode: VideoContentMode) {
    if (![viewport.width, viewport.height, video.width, video.height].every(value => Number.isFinite(value) && value > 0)) {
      return undefined;
    }

    const scale = (mode === VideoContentMode.fill ? Math.max : Math.min)(viewport.width / video.width, viewport.height / video.height);
    const width = video.width * scale;
    const height = video.height * scale;
    return { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height };
  }

  /**
   * 忽略黑边和无效点，撤销显示镜像后取整并限制在模型输入范围内。
   */
  static map(point: { x: number; y: number }, frame: InteractionFrame, video: { width: number; height: number }): RealtimePoint | undefined {
    const rect = this.displayedFrame(frame.viewportSize, video, frame.contentMode);
    if (!rect || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return undefined;
    }

    if (frame.contentMode === VideoContentMode.fit &&
        (point.x < rect.x || point.x > rect.x + rect.width || point.y < rect.y || point.y > rect.y + rect.height)) {
      return undefined;
    }

    const x = (point.x - rect.x) / rect.width;
    const y = (point.y - rect.y) / rect.height;
    return new RealtimePoint({
      x: Math.min(video.width - 1, Math.max(0, Math.round((frame.mirrored ? 1 - x : x) * video.width))),
      y: Math.min(video.height - 1, Math.max(0, Math.round(y * video.height))),
    });
  }
}
