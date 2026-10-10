/** Agora 新轨道/新生成任务的默认启动档位；不改变 L1 恢复上限。 */
export const INITIAL_QUALITY_LEVEL = 2;

/** 上下行共用的五档基准规格；网络质量等级不与档位直接映射。 */
export const QUALITY_TIERS = {
  L1: { width: 1024, height: 1920, frameRate: 30 },
  L2: { width: 768, height: 1440, frameRate: 24 },
  L3: { width: 640, height: 1200, frameRate: 24 },
  L4: { width: 512, height: 960, frameRate: 20 },
  L5: { width: 384, height: 720, frameRate: 16 },
} as const;
