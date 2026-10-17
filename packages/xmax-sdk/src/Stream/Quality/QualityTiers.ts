/** 支持自动调档的 RTC 新轨道/新生成任务的默认启动档位；不改变 L1 恢复上限。 */
export const INITIAL_QUALITY_LEVEL = 2;

/**
 * 自动缩放的短边下限；原始短边更小时不放大。
 */
export const MINIMUM_QUALITY_SHORT_SIDE = 240;

/** 上下行共用的五档基准规格；网络质量等级不与档位直接映射。 */
export const QUALITY_TIERS = {
  L1: { scale: 1, width: 1024, height: 1920, frameRate: 30 },
  L2: { scale: 0.8, width: 818, height: 1536, frameRate: 24 },
  L3: { scale: 0.65, width: 664, height: 1248, frameRate: 24 },
  L4: { scale: 0.5, width: 512, height: 960, frameRate: 20 },
  L5: { scale: 0.4, width: 408, height: 768, frameRate: 16 },
} as const;
