import { XmaxError } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import { RoomEvent } from "./RoomEvent";

export interface RoomHeartbeatOptions {
  /** RTC 引擎与消息能力组件。 */
  rtcManager: RtcManaging;

  /** 心跳间隔（毫秒）；默认 10 秒。 */
  intervalMs?: number;

  /** 心跳等待实现（可替换，测试用）。 */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 周期发送 RTC 房间心跳，并用版本号隔离已停止的旧周期。
 */
export class RoomHeartbeat {
  // 基础层组件
  private readonly rtcManager: RtcManaging;

  // 心跳配置
  private readonly intervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  // 运行状态
  private cycleVersion = 0;

  /**
   * 创建房间心跳。
   *
   * @param options.rtcManager RTC 引擎与消息能力组件。
   * @param options.intervalMs 心跳间隔（毫秒）；默认 10 秒。
   * @param options.sleep 心跳等待实现（可替换，测试用）。
   */
  constructor(options: RoomHeartbeatOptions) {
    this.rtcManager = options.rtcManager;
    this.intervalMs = options.intervalMs ?? 10_000;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /** 启动周期心跳；重复启动会替换当前周期。 */
  start(userID: string): void {
    const version = ++this.cycleVersion;
    void this.run(version, userID);
  }

  /** 停止当前心跳周期；迟到结果不会再发送。 */
  stop(): void {
    this.cycleVersion += 1;
  }

  /** 周期循环：等待后发送心跳；发送失败仅记录日志，周期继续。 */
  private async run(version: number, userID: string): Promise<void> {
    while (this.cycleVersion === version) {
      await this.sleep(this.intervalMs);
      if (this.cycleVersion !== version) {
        return;
      }
      try {
        this.rtcManager.sendRoomMessage(RoomEvent.heartbeat({ userID }));
      } catch (error) {
        if (this.cycleVersion !== version) {
          return;
        }
        XmaxLogger.room.error(
          () =>
            `发送 RTC 房间心跳失败 (Failed to Send RTC Room Heartbeat)\n` +
            `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
        );
      }
    }
  }
}
