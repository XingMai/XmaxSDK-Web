/** 自动调档的样本阈值与时间窗口；样本数须为正整数，时间单位均为毫秒。 */
export interface QualityPolicy {
  /** 连续差网络样本（质量等级 4～5）达到此次数时降一档，默认 3 次。 */
  poorSamples: number;

  /** 连续好网络样本（质量等级 1～2）达到此次数时尝试升一档，默认 5 次。 */
  goodSamples: number;

  /** 切档成功或应用失败后的稳定等待时间，期间不累计质量样本，默认 4000 ms。 */
  stabilizationMs: number;

  /** 升档成功后的观察窗口；窗口内触发降档则判定试升失败，默认 20000 ms。 */
  probeMs: number;

  /** 试升失败并回退成功后禁止再次升档的时长，期间仍允许降档，默认 60000 ms。 */
  upgradeCooldownMs: number;

  /** 样本最大有效时长及相邻样本最大间隔；超时样本不计入，间隔超限则重新累计，默认 5000 ms。 */
  sampleTimeoutMs: number;
}

/** 快降慢升的默认策略，控制器可按需覆盖各项参数。 */
export const DEFAULT_POLICY: QualityPolicy = {
  poorSamples: 3,
  goodSamples: 5,
  stabilizationMs: 4000,
  probeMs: 20000,
  upgradeCooldownMs: 60000,
  sampleTimeoutMs: 5000,
};
