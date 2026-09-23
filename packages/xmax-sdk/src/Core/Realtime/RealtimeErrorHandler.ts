import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { RealtimeTerminationScope } from "./RealtimeCoordinator";

/**
 * 实时业务异步错误的统一出口。
 * 当前为简化实现：记录日志并保留待上报错误。
 */
export class RealtimeErrorHandler {
  /**
   * 运行状态
   */
  private pendingFailures: XmaxError[] = [];

  /**
   * 上报错误；当前通过日志输出，后续里程碑接入状态原因上报。
   */
  async report(error: XmaxError): Promise<void> {
    if (error.code === XmaxErrorCode.cancelled) {
      return;
    }
    this.pendingFailures.push(error);
    XmaxLogger.realtime.error(
      () =>
        `实时业务错误 (Realtime Error)\n└─ ${XmaxLogger.localized("原因：", "Reason: ")}` +
        `${error.code} ${error.message}`,
    );
  }

  /**
   * 清理仍属于已终止生命周期的后台故障。
   */
  invalidatePendingFailures(_target: RealtimeTerminationScope): void {
    this.pendingFailures = [];
  }
}
