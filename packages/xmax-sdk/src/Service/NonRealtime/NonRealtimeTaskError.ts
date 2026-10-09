import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { NonRealtimeTask } from "./NonRealtimeTask";

/**
 * 服务端任务失败或终态结果不可用；保留最后的任务快照供接入方展示及恢复查询。
 */
export class NonRealtimeTaskError extends XmaxError {
  /**
   * 失败上下文
   */
  readonly task: NonRealtimeTask;

  /**
   * 使用 API 错误分类，不虚构服务端未返回的业务错误码。
   */
  constructor(task: NonRealtimeTask, message: string) {
    super(XmaxErrorCode.apiError, message);
    this.name = "NonRealtimeTaskError";
    this.task = task;
  }
}
