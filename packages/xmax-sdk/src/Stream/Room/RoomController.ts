import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { toRoomJoinConfiguration } from "../../Service/Realtime/RealtimeSessionConnection";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RtcSessionConnection } from "../../Service/Realtime/RealtimeSessionConnection";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RoomControlling, RoomListener } from "./RoomControlling";
import { RoomEvent, type RoomEventTargetSize } from "./RoomEvent";
import { RoomHeartbeat } from "./RoomHeartbeat";
import { RoomMessageCodec } from "./RoomMessageCodec";

/**
 * 房间生命周期状态。
 */
type RoomState =
  | { kind: "idle" }
  | { kind: "joining"; operationID: string }
  | { kind: "joined"; userID: string }
  | { kind: "leaving" };

export interface RoomControllerOptions {
  /**
   * RTC 引擎与房间能力组件。
   */
  rtcManager: RtcManaging;

  /**
   * 房间心跳组件（可替换，测试用）。
   */
  heartbeat?: RoomHeartbeat;

  /**
   * 房间消息编解码组件（可替换，测试用）。
   */
  codec?: RoomMessageCodec;
}

/**
 * 管理 RTC 房间生命周期、心跳和实时生成信令。
 *
 * 入站消息经 `RoomMessageCodec` 组包后按 `user_id` 目标字段过滤
 * （RTC 消息通道使用广播语义），再分发给监听器。
 */
export class RoomController implements RoomControlling {
  /**
   * 基础层组件
   */
  private readonly rtcManager: RtcManaging;

  /**
   * 传输层组件
   */
  private readonly heartbeat: RoomHeartbeat;
  private codec: RoomMessageCodec;
  private readonly customCodec: boolean;
  private sendTail: Promise<void> = Promise.resolve();

  /**
   * 事件监听
   */
  private listener?: RoomListener;

  /**
   * 房间资源
   */
  private state: RoomState = { kind: "idle" };
  private leaveOperation?: Promise<void>;

  /**
   * 创建房间控制器。
   *
   * @param options.rtcManager RTC 引擎与房间能力组件。
   * @param options.heartbeat 房间心跳组件（可替换，测试用）。
   * @param options.codec 房间消息编解码组件（可替换，测试用）。
   */
  constructor(options: RoomControllerOptions) {
    this.rtcManager = options.rtcManager;
    this.heartbeat =
      options.heartbeat ?? new RoomHeartbeat({ rtcManager: options.rtcManager });
    this.codec = options.codec ?? new RoomMessageCodec();
    this.customCodec = options.codec !== undefined;
  }

  /**
   * 加入实时房间，并在异步边界前后确认连接操作仍然有效。
   *
   * @throws 已有房间未离开、操作失效或进房失败时抛出错误。
   */
  async join(
    connection: RtcSessionConnection,
    ensureActive: () => void,
  ): Promise<void> {
    try {
      ensureActive();
    } catch (error) {
      throw XmaxError.from(error);
    }
    if (this.state.kind !== "idle" || this.leaveOperation) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Leave the current RTC room before joining another one",
      );
    }

    const operationID = `join-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.state = { kind: "joining", operationID };
    this.heartbeat.stop();

    try {
      if (!this.customCodec) this.codec = new RoomMessageCodec(
        connection.provider === RtcProvider.vertc ? null : connection.provider === RtcProvider.agora ? "__agora_chunk__" : "__trtc_chunk__",
      );
      await this.rtcManager.joinRoom(toRoomJoinConfiguration(connection));
      ensureActive();
      if (
        this.state.kind !== "joining" ||
        this.state.operationID !== operationID ||
        this.leaveOperation
      ) {
        throw new XmaxError(XmaxErrorCode.cancelled, "RTC room join was cancelled");
      }

      this.state = { kind: "joined", userID: connection.userID };
      this.heartbeat.start(connection.userID);
    } catch (error) {
      if (
        this.state.kind === "joining" &&
        this.state.operationID === operationID &&
        !this.leaveOperation
      ) {
        this.state = { kind: "leaving" };
        this.heartbeat.stop();
        await this.rtcManager.leaveRoom();
        if (this.state.kind === "leaving") {
          this.state = { kind: "idle" };
        }
      }
      throw XmaxError.from(error);
    }
  }

  /**
   * 停止房间心跳并离开当前 RTC 房间；并发的离开操作共享同一个任务。
   */
  async leave(): Promise<void> {
    if (this.leaveOperation) {
      await this.leaveOperation;
      return;
    }
    if (this.state.kind === "idle" || this.state.kind === "leaving") {
      return;
    }
    const operation = this.performLeave();
    this.leaveOperation = operation;
    await operation;
  }

  /**
   * 发送生成开始信令。
   *
   * @throws 房间未就绪或信令发送失败时抛出错误。
   */
  startGeneration(options: {
    /** 是否由后端镜像输入画面，默认 false。 */
    mirror?: boolean;
    taskID: string;
    videoFormat: RealtimeVideoFormat;
    targetSize?: RoomEventTargetSize;
    context: RealtimeContext;
  }): Promise<void> {
    return this.send(
      RoomEvent.start({
        mirror: options.mirror ?? false,
        userID: this.requireUserID(),
        taskID: options.taskID,
        videoFormat: options.videoFormat,
        targetSize: options.targetSize,
        context: options.context,
      }),
    );
  }

  /**
   * 发送生成条件变更信令。
   *
   * @throws 房间未就绪或信令发送失败时抛出错误。
   */
  changeGenerationCondition(options: {
    taskID: string;
    videoFormat: RealtimeVideoFormat;
    targetSize?: RoomEventTargetSize;
    context: RealtimeContext;
  }): Promise<void> {
    return this.send(
      RoomEvent.changeCondition({
        userID: this.requireUserID(),
        taskID: options.taskID,
        videoFormat: options.videoFormat,
        targetSize: options.targetSize,
        context: options.context,
      }),
    );
  }

  /**
   * 调整当前生成任务的回传尺寸。
   *
   * @throws 操作已取消、房间未就绪或信令发送失败时抛出错误。
   */
  changeTargetSize(options: {
    taskID: string;
    targetSize: RoomEventTargetSize;
    ensureActive: () => void;
  }): Promise<void> {
    options.ensureActive();
    return this.send(
      RoomEvent.changeTargetSize({
        userID: this.requireUserID(),
        taskID: options.taskID,
        targetSize: options.targetSize,
      }),
    );
  }

  /**
   * 尝试发送生成停止信令；未进房或任务标识为空时忽略。
   */
  stopGeneration(taskID: string): Promise<void> {
    if (!taskID || this.state.kind !== "joined") {
      return Promise.resolve();
    }
    return this.send(RoomEvent.stop({ userID: this.state.userID, taskID }));
  }

  /**
   * 发送生成任务的交互轨迹；任务标识或轨迹为空时忽略。
   */
  sendTracks(taskID: string, points: RealtimePoint[]): Promise<void> {
    if (!taskID || points.length === 0) {
      return Promise.resolve();
    }
    return this.send(
      RoomEvent.tracks({
        userID: this.requireUserID(),
        taskID,
        points,
      }),
    );
  }

  /**
   * 设置房间事件监听器，传入空值时清除监听器。
   */
  setListener(listener?: RoomListener): void {
    this.listener = listener;
  }

  /**
   * 执行离开：复位状态、停止心跳、清空组包缓存并退房。
   */
  private async performLeave(): Promise<void> {
    this.state = { kind: "idle" };
    this.heartbeat.stop();
    this.codec.reset();
    this.sendTail = Promise.resolve();
    try { await this.rtcManager.leaveRoom(); }
    finally { this.leaveOperation = undefined; }
  }

  /**
   * 组包入站消息并按目标用户过滤后分发完整业务消息。
   */
  handleIncomingMessage(senderUserID: string, raw: string): void {
    const parsed = this.codec.processIncoming(senderUserID, raw);
    if (typeof parsed !== "object" || parsed === null) {
      return;
    }

    const message = parsed as Record<string, unknown>;

    // RTC 消息使用广播语义，按 payload 中的 user_id 过滤目标。
    const targetUserID =
      typeof message.user_id === "string" ? message.user_id : undefined;
    const ownUserID = this.state.kind === "joined" ? this.state.userID : undefined;
    if (targetUserID && ownUserID && targetUserID !== ownUserID) {
      return;
    }

    this.listener?.onRoomMessage(senderUserID, message);
  }

  /**
   * 发送房间信令并输出日志。
   */
  private send(message: string): Promise<void> {
    const state = this.state;
    const packets = this.codec.encodeOutgoing(message);
    const operation = this.sendTail.then(async () => {
      for (const packet of packets) {
        if (state !== this.state || state.kind !== "joined") {
          throw new XmaxError(XmaxErrorCode.cancelled, "Room message was cancelled");
        }
        await this.rtcManager.sendRoomMessage(packet);
      }
      XmaxLogger.room.info(
        () =>
          `发送房间信令 (Outbound Room Signaling)\n` +
          `└─ ${XmaxLogger.localized("内容：", "Content:")}\n${JSON.stringify(JSON.parse(message), null, 2)}`,
      );
    }).catch(error => { throw XmaxError.from(error); });
    this.sendTail = operation.catch(() => {});
    return operation;
  }

  /**
   * 返回当前房间中的用户标识；未进房时抛出错误。
   */
  private requireUserID(): string {
    if (this.state.kind !== "joined") {
      throw new XmaxError(XmaxErrorCode.rtcError, "RTC room is not joined");
    }
    return this.state.userID;
  }
}
