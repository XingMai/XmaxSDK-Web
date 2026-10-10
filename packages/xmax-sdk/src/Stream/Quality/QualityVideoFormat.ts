import { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { QUALITY_TIERS } from "./QualityTiers";

/** 上下行共用的尺寸换算；保持原始方向，不改变帧率或码率。 */
export function qualityVideoSize(baseline: RealtimeVideoFormat, level: number): { width: number; height: number } {
  const tier = Object.values(QUALITY_TIERS)[level - 1];
  if (!Number.isInteger(level) || !tier) throw new Error("Unsupported quality level");
  baseline.validate();
  const scale = tier.width / QUALITY_TIERS.L1.width;
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
  return { width: even(baseline.width * scale), height: even(baseline.height * scale) };
}

/**
 * 以用户初始/手动配置为 L1，按统一比例缩小；标准源恰好对应预设五档。
 * 不读取 RTC 实际发送统计，避免自动降档后丢失恢复上限。
 * 显式码率沿用用户约束；缺省码率保持 undefined，由编码层按目标尺寸和帧率解析。
 */
export function qualityVideoFormat(baseline: RealtimeVideoFormat, level: number): RealtimeVideoFormat {
  const size = qualityVideoSize(baseline, level);
  const tier = Object.values(QUALITY_TIERS)[level - 1]!;
  return new RealtimeVideoFormat({
    ...baseline,
    ...size,
    fps: Math.min(baseline.fps, tier.frameRate),
  });
}
