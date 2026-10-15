import { INITIAL_QUALITY_LEVEL, QUALITY_TIERS } from "./QualityTiers";
import type { RtcProvider } from "../../Foundation/RTC/RtcProvider";

type QualityDirection = "uplink" | "downlink";

/** 最近一次成功应用的档位；按 RTC 提供方、模型、方向隔离，不保存媒体、凭据或会话 ID。 */
export class QualityHistory {
  constructor(private readonly model: string, private readonly provider: RtcProvider) {}

  /** 无记录、损坏、SSR 或浏览器禁止存储时使用默认 L2。 */
  read(direction: QualityDirection): number {
    try {
      const level = Number(globalThis.localStorage.getItem(this.key(direction)));
      if (this.isValid(level)) return level;
    } catch { /* 存储不可用不影响生成。 */ }
    return INITIAL_QUALITY_LEVEL;
  }

  /** 仅在应用成功后调用；下行成功表示信令已发送，不代表服务端已确认生效。 */
  write(direction: QualityDirection, level: number): void {
    if (!this.isValid(level)) return;
    try {
      globalThis.localStorage.setItem(this.key(direction), String(level));
    } catch { /* 配额或权限错误不影响自动调档。 */ }
  }

  private key(direction: QualityDirection): string {
    return `xmax:quality:v1:${this.provider}:${encodeURIComponent(this.model)}:${direction}`;
  }

  private isValid(level: number): boolean {
    return Number.isInteger(level) && level >= 1 && level <= Object.keys(QUALITY_TIERS).length;
  }
}
