import { INITIAL_QUALITY_LEVEL, QUALITY_TIERS } from "./QualityTiers";
import type { RtcProvider } from "../../Foundation/RTC/RtcProvider";

type QualityDirection = "uplink" | "downlink";

/**
 * 一小时内成功应用的档位；按 RTC 提供方、模型、方向隔离，不保存媒体或凭据。
 */
export class QualityHistory {
  /**
   * 历史档位有效期，单位为毫秒。
   */
  private static readonly expirationMs = 60 * 60 * 1000;

  /**
   * 创建按模型与 RTC 提供方隔离的档位存储。
   */
  constructor(
    private readonly model: string,
    private readonly provider: RtcProvider,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * 无记录、过期、损坏、时钟回退或存储不可用时使用默认 L2。
   */
  read(direction: QualityDirection): number {
    try {
      const entry = JSON.parse(globalThis.localStorage.getItem(this.key(direction)) ?? "null");
      const now = this.now();
      if (entry && this.isValid(entry.level) && Number.isFinite(entry.savedAt) &&
        entry.savedAt > 0 && now >= entry.savedAt && now - entry.savedAt < QualityHistory.expirationMs) {
        return entry.level;
      }
    } catch { /* 存储不可用不影响生成。 */ }
    return INITIAL_QUALITY_LEVEL;
  }

  /**
   * 应用成功后保存档位并刷新一小时有效期；下行成功仅表示信令已发送。
   */
  write(direction: QualityDirection, level: number): void {
    if (!this.isValid(level)) {
      return;
    }
    try {
      globalThis.localStorage.setItem(this.key(direction), JSON.stringify({ level, savedAt: this.now() }));
    } catch { /* 配额或权限错误不影响自动调档。 */ }
  }

  /**
   * 生成当前方向的存储键；无时间戳的旧记录按无效记录处理。
   */
  private key(direction: QualityDirection): string {
    return `xmax:quality:v1:${this.provider}:${encodeURIComponent(this.model)}:${direction}`;
  }

  /**
   * 校验档位编号。
   */
  private isValid(level: number): boolean {
    return Number.isInteger(level) && level >= 1 && level <= Object.keys(QUALITY_TIERS).length;
  }
}
