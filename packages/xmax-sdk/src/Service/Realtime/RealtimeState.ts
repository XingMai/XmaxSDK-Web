import { XmaxError } from "../../Foundation/Errors/XmaxError";

/**
 * 实时业务连接状态。
 */
export enum RealtimeConnectionState {
  /**
   * 没有可用的本地媒体流。
   */
  idle = "Idle",

  /**
   * 正在准备本地媒体流；摄像头还需等待有效帧和预览视图绑定。
   */
  preparing = "Preparing",

  /**
   * 本地媒体流已就绪，可以预览、连接和生成。
   */
  ready = "Ready",

  /**
   * 正在创建 Session、加入 Room 并发布本地流。
   */
  connecting = "Connecting",

  /**
   * 实时连接已建立，当前没有生成任务。
   */
  connected = "Connected",

  /**
   * 实时连接已建立且生成任务正在运行。
   */
  generating = "Generating",

  /**
   * 正在清理生成、Room 和 Session 资源。
   */
  disconnecting = "Disconnecting",
}

/**
 * 进入当前实时状态的原因。
 */
export type RealtimeReason =
  | { kind: "normal" }
  | { kind: "orientationChanged" }
  | { kind: "failure"; error: XmaxError };

export const RealtimeReason = {
  normal: { kind: "normal" } as RealtimeReason,
  orientationChanged: { kind: "orientationChanged" } as RealtimeReason,
  /**
   * 将 SDK 错误包装为状态切换原因，保留错误码和原始说明。
   */
  failure(error: XmaxError): RealtimeReason {
    return { kind: "failure", error };
  },
};

export interface RealtimeStateInit {
  connectionState: RealtimeConnectionState;
  sessionID?: string;
  taskID?: string;
  reason?: RealtimeReason;
}

/**
 * 实时业务当前状态快照。
 */
export class RealtimeState {
  /**
   * 连接生命周期
   */
  /**
   * 当前连接生命周期状态。
   */
  readonly connectionState: RealtimeConnectionState;

  /**
   * 业务标识
   */
  /**
   * 当前或最近一次实时 Session 标识。
   */
  readonly sessionID?: string;

  /**
   * 当前生成任务标识。
   */
  readonly taskID?: string;

  /**
   * 状态变化原因
   */
  /**
   * 进入当前状态的原因；正常开始新的操作时清空。
   */
  readonly reason?: RealtimeReason;

  /**
   * 创建实时状态快照。
   *
   * @param init.connectionState 当前连接生命周期状态。
   * @param init.sessionID 当前或最近一次实时 Session 标识。
   * @param init.taskID 当前生成任务标识。
   * @param init.reason 状态变化原因，默认无。
   */
  constructor(init: RealtimeStateInit) {
    this.connectionState = init.connectionState;
    this.sessionID = init.sessionID;
    this.taskID = init.taskID;
    this.reason = init.reason;
  }

  /**
   * 判断当前状态与另一状态是否等价：连接状态、会话、任务与原因种类一致。
   *
   * @param other 待比较的状态。
   */
  equals(other: RealtimeState): boolean {
    return (
      this.connectionState === other.connectionState &&
      this.sessionID === other.sessionID &&
      this.taskID === other.taskID &&
      this.reason?.kind === other.reason?.kind
    );
  }
}

/**
 * 实时状态监听器。
 */
export type RealtimeStateListener = (state: RealtimeState) => void;
