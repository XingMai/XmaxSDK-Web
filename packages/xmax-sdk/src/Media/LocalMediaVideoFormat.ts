import { resolutionBuckets } from "../Service/Realtime/RealtimeModel";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import type { MediaService } from "../Service/Media/MediaService";

/**
 * 为本地图片和视频选择最接近宽高比的模型档位；等距时优先横屏。
 * 无固定档位时沿用像素预算规则，不修改帧率和编码配置。
 */
export function resolveLocalMediaVideoFormat(format: RealtimeVideoFormat, mediaService: MediaService): RealtimeVideoFormat {
  format.validate();
  const buckets = resolutionBuckets(mediaService.model);
  let target = buckets.find(size => size.width === format.width && size.height === format.height);

  if (!target && buckets.length > 0) {
    const ratio = format.width / format.height;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const bucket of buckets) {
      // 对数比例距离对横竖方向对称，避免正方形输入偏向竖屏。
      const distance = Math.abs(Math.log((bucket.width / bucket.height) / ratio));
      const tied = Math.abs(distance - bestDistance) < 1e-9;
      if (distance < bestDistance - 1e-9 ||
          (tied && bucket.width >= bucket.height && target && target.width < target.height)) {
        target = bucket;
        bestDistance = distance;
      }
    }
  }

  const size = mediaService.resolveModelInputSize(target ?? format);
  return format.resized(size.width, size.height);
}
