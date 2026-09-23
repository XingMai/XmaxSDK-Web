/// <reference types="@webgpu/types" />
import type { ModelSize } from "../../../Service/Realtime/RealtimeModel";

/**
 * 不缓存失败结果，允许设备恢复后显式重试；能力查询不创建 GPUDevice。
 */
export async function frameInterpolationAdapter(size?: ModelSize): Promise<GPUAdapter | null> {
  if (typeof navigator === "undefined" || !navigator.gpu ||
      typeof HTMLVideoElement === "undefined" ||
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function") return null;
  if (size && (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) ||
      size.width <= 0 || size.height <= 0)) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter?.features.has("shader-f16")) return null;
    if (size && (Math.ceil(size.width / 16) * 16 > adapter.limits.maxTextureDimension2D ||
        Math.ceil(size.height / 16) * 16 > adapter.limits.maxTextureDimension2D)) return null;
    return adapter;
  } catch {
    return null;
  }
}
