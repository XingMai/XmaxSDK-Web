import type {
  NonRealtimeTask, NonRealtimeTaskOptions, NonRealtimeTaskListOptions, NonRealtimeTaskPage,
} from "../../Service/NonRealtime/NonRealtimeTask";

/**
 * 本地任务等待选项；所有时间单位均为毫秒。
 */
export interface NonRealtimeWaitOptions {
  /**
   * 成功查询后等待多久再查询，默认 2000；必须为正数。
   */
  intervalMs?: number;
  /**
   * 总等待时限，必须为正数；省略时持续等待直至终态或取消。
   */
  timeoutMs?: number;
  /**
   * 连续瞬时查询错误允许重试的次数，默认 3；成功查询后重置，0 表示不重试。
   */
  maxConsecutiveRetries?: number;
  /**
   * 停止轮询及正在进行的查询，不取消服务端任务或退款。
   */
  signal?: AbortSignal;
  /**
   * 每次成功查询的任务快照（含终态），不是生成百分比；回调异常不影响轮询。
   */
  onTaskUpdated?: (task: NonRealtimeTask) => void;
}

/**
 * 非实时视频任务能力；各任务和等待操作相互独立，不维护唯一的当前任务。
 */
export interface XmaxNonRealtimeManaging {
  /**
   * 提交并立即返回任务；不等待生成，不自动上传资源，也不自动重试提交请求。
   * 超时或响应解析失败不能证明服务端未创建任务，重复提交可能再次扣费。
   */
  submitTask(options: NonRealtimeTaskOptions): Promise<NonRealtimeTask>;
  /**
   * 查询单个任务；服务端 error 状态原样返回，不作为 HTTP 查询失败抛出。
   */
  getTask(taskUid: string, options?: { signal?: AbortSignal }): Promise<NonRealtimeTask>;
  /**
   * 批量查询最多 100 个 ID，去重后按请求顺序返回；任一任务无权限或不存在则整体失败。
   */
  getTasks(taskUids: readonly string[]): Promise<readonly NonRealtimeTask[]>;
  /**
   * 查询任务列表；默认第一页、每页 10 条，最多 100 条。
   */
  listTasks(options?: NonRealtimeTaskListOptions): Promise<NonRealtimeTaskPage>;
  /**
   * 串行轮询直到 completed 且结果 URL 可用；任务 error 时抛出 NonRealtimeTaskError。
   * 超时、取消只停止本地等待，之后可使用同一任务 ID 继续查询或等待。
   */
  waitForCompletion(taskUid: string, options?: NonRealtimeWaitOptions): Promise<NonRealtimeTask>;
}
