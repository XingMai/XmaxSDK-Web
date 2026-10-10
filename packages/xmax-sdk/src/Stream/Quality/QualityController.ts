import { QUALITY_TIERS } from "./QualityTiers";
import { DEFAULT_POLICY, type QualityPolicy } from "./QualityPolicy";

/** 按 L1～L5 顺序供状态机逐级切换，规格只在共享定义中维护。 */
const ORDERED_QUALITY_TIERS = Object.values(QUALITY_TIERS);

export interface QualityChange {
  /** 切档前后的档位编号，范围 1～5；不能仅靠帧率区分档位。 */
  from: number;
  to: number;
  /** 基准竖屏尺寸，实际发送尺寸由调用方按原始宽高比和方向换算。 */
  width: number;
  height: number;
  frameRate: number;
  reason: "poorNetwork" | "probeUpgrade" | "failedProbe";
}

/**
 * 每个方向各自持有的质量状态机，默认停止，不持有 RTC 或定时器。
 * 调用方须在生成成功后 start，仅传入新到达的质量样本，重连/换流/结束时 stop。
 * apply 必须遵循 AbortSignal 及会话操作租约。下行无生效 ACK 时，档位仅表示已发送目标。
 */
export class QualityController {
  private readonly policy: QualityPolicy;
  private active = false;
  private index = 0;
  private good = 0;
  private poor = 0;
  private lastSampleAt?: number;
  private stableUntil = 0;
  private upgradeAfter = 0;
  private probeUntil = 0;
  private switching = false;
  private lifecycle = new AbortController();

  constructor(
    private readonly apply: (change: QualityChange, signal: AbortSignal) => Promise<void>,
    private readonly now: () => number = () => performance.now(),
    policy: Partial<QualityPolicy> = {},
  ) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    for (const value of Object.values(this.policy)) {
      if (!Number.isFinite(value) || value < 0) throw new Error("Invalid quality policy");
    }
    for (const value of [this.policy.poorSamples, this.policy.goodSamples]) {
      if (!Number.isInteger(value) || value < 1) throw new Error("Sample counts must be positive integers");
    }
  }

  get snapshot() {
    return Object.freeze({
      active: this.active, level: this.index + 1, ...ORDERED_QUALITY_TIERS[this.index]!,
      switching: this.switching, upgradeAfter: this.upgradeAfter,
    });
  }

  /** 传入调用方保存的档位，不在 start 中擅自改写编码配置。 */
  start(level = 1): void {
    if (!Number.isInteger(level) || level < 1 || level > ORDERED_QUALITY_TIERS.length) {
      throw new Error("Unsupported quality level");
    }
    this.stop();
    this.lifecycle = new AbortController();
    this.index = level - 1;
    this.active = true;
    this.stableUntil = this.upgradeAfter = this.probeUntil = 0;
  }

  /** 取消旧会话的迟到结果；底层尚未完成时仍保持串行限制。 */
  stop(): void {
    this.active = false;
    this.lifecycle.abort();
    this.resetSamples();
  }

  /** 前台操作期间丢弃累计样本，但保留试升失败后的冷却时间。 */
  resetSamples(): void {
    this.resetCounts();
    this.lastSampleAt = undefined;
  }

  /** 只接收质量事件，不得用定时器重复提交同一份缓存统计。异常由调用方记录。 */
  async observe(quality: number | undefined, sampleAt = this.now()): Promise<QualityChange | undefined> {
    if (!this.active || this.switching || !Number.isFinite(sampleAt)) return;
    const now = this.now();
    if (sampleAt > now) return;
    if (this.lastSampleAt !== undefined) {
      if (sampleAt <= this.lastSampleAt) return;
      if (sampleAt - this.lastSampleAt > this.policy.sampleTimeoutMs) this.resetCounts();
    }
    this.lastSampleAt = sampleAt;
    if (now - sampleAt > this.policy.sampleTimeoutMs || sampleAt < this.stableUntil) {
      this.resetCounts();
      return;
    }
    if (quality === 4 || quality === 5) {
      this.good = 0;
      this.poor++;
      if (this.poor >= this.policy.poorSamples && this.index < ORDERED_QUALITY_TIERS.length - 1) {
        return this.change(this.index + 1, now < this.probeUntil ? "failedProbe" : "poorNetwork");
      }
    } else if (quality === 1 || quality === 2) {
      this.poor = 0;
      if (sampleAt < this.upgradeAfter) { this.good = 0; return; }
      this.good++;
      if (this.good >= this.policy.goodSamples && this.index > 0) {
        return this.change(this.index - 1, "probeUpgrade");
      }
    } else {
      // 一般、未知、断连和无效等级均打断连续计数，不推测可用带宽。
      this.resetCounts();
    }
    return;
  }

  private resetCounts(): void { this.good = this.poor = 0; }

  private async change(index: number, reason: QualityChange["reason"]): Promise<QualityChange | undefined> {
    const lifecycle = this.lifecycle;
    const change: QualityChange = { from: this.index + 1, to: index + 1, ...ORDERED_QUALITY_TIERS[index]!, reason };
    this.switching = true;
    this.resetCounts();
    try {
      await this.apply(change, lifecycle.signal);
      if (lifecycle.signal.aborted) return;
      this.index = index;
      const now = this.now();
      this.stableUntil = now + this.policy.stabilizationMs;
      this.probeUntil = reason === "probeUpgrade" ? now + this.policy.probeMs : 0;
      if (reason === "failedProbe") this.upgradeAfter = now + this.policy.upgradeCooldownMs;
      return change;
    } catch (error) {
      if (!lifecycle.signal.aborted) {
        this.stableUntil = this.now() + this.policy.stabilizationMs;
        throw error;
      }
      return;
    } finally {
      this.switching = false;
    }
  }
}
