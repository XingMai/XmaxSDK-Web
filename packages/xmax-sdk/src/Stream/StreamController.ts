import { XmaxError, XmaxErrorCode, type XmaxErrorListener } from "../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../Foundation/Logging/XmaxLogger";
import { RemoteStream } from "../Foundation/RTC/RemoteStream";
import type { RtcManaging } from "../Foundation/RTC/RtcManaging";
import type { RemoteVideoStatisticsListener, VideoStatisticsListener } from "../Foundation/RTC/VideoStatistics";
import type { RealtimePoint } from "../Service/Realtime/RealtimePoint";
import type { RealtimeSessionConnection } from "../Service/Realtime/RealtimeSessionConnection";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import type { RoomListener, RoomControlling } from "./Room/RoomControlling";
import { RoomController } from "./Room/RoomController";
import type { RoomEventTargetSize } from "./Room/RoomEvent";
import type { EncodingControlling } from "./Encoding/EncodingControlling";
import { EncodingController } from "./Encoding/EncodingController";
import type {
  RemoteStreamListener,
  StreamControlling,
  StreamGenerationOptions,
} from "./StreamControlling";

/** 生成确认等待器。 */
interface GenerationWaiter {
  taskID: string;
  resolve: () => void;
  reject: (error: XmaxError) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
  confirmationPending: boolean;
}

/** 传输层运行状态。 */
interface StreamState {
  roomID: string;
  botID: string;
  localVideoPublished: boolean;
  localAudioPublished: boolean;
  subscribedRemoteUserIDs: Set<string>;
  subscribedRemoteAudioUserIDs: Set<string>;
  generationTaskID?: string;
  generationWaiter?: GenerationWaiter;
  activeRemoteStream?: RemoteStream;
}

function makeInitialState(): StreamState {
  return {
    roomID: "",
    botID: "",
    localVideoPublished: false,
    localAudioPublished: false,
    subscribedRemoteUserIDs: new Set(),
    subscribedRemoteAudioUserIDs: new Set(),
  };
}

export interface StreamControllerOptions {
  /** RTC 引擎与媒体传输组件。 */
  rtcManager: RtcManaging;

  /** 房间生命周期与信令组件（可替换，测试用）。 */
  roomController?: RoomControlling;

  /** 视频编码参数配置组件（可替换，测试用）。 */
  encodingController?: EncodingControlling;

  /** 运行期错误回调。 */
  errorListener?: XmaxErrorListener;

  /** 远端生成流就绪与清理回调。 */
  remoteStreamListener?: RemoteStreamListener;

  /** 生成开始确认超时时间（毫秒）；默认 30 秒。 */
  generationTimeoutMs?: number;
}

/**
 * 统一协调 RTC 房间、媒体流发布订阅和生成任务确认。
 *
 * 生成确认不使用 SEI：以目标机器人发布远端视频（并完成订阅、
 * 渲染绑定被接受）作为生成开始成功的确认信号。
 */
export class StreamController implements StreamControlling {
  // 基础层组件
  private readonly rtcManager: RtcManaging;

  // 传输层组件
  private readonly roomController: RoomControlling;
  private readonly encodingController: EncodingControlling;

  // 事件监听
  private readonly errorListener: XmaxErrorListener;
  private readonly remoteStreamListener: RemoteStreamListener;
  private localVideoStatisticsListener?: VideoStatisticsListener;
  private remoteVideoStatisticsListener?: RemoteVideoStatisticsListener;

  // 生成配置
  private readonly generationTimeoutMs: number;

  // 音频配置
  private remoteAudioVolumePercentage = 100;

  // 运行状态
  private state: StreamState = makeInitialState();

  /**
   * 创建传输层控制器。
   *
   * @param options.rtcManager RTC 引擎与媒体传输组件。
   * @param options.roomController 房间生命周期与信令组件（可替换，测试用）。
   * @param options.encodingController 视频编码参数配置组件（可替换，测试用）。
   * @param options.errorListener 运行期错误回调。
   * @param options.remoteStreamListener 远端生成流就绪与清理回调。
   * @param options.generationTimeoutMs 生成开始确认超时时间（毫秒）；默认 30 秒。
   */
  constructor(options: StreamControllerOptions) {
    this.rtcManager = options.rtcManager;
    this.roomController =
      options.roomController ??
      new RoomController({ rtcManager: options.rtcManager });
    this.encodingController =
      options.encodingController ??
      new EncodingController({ rtcManager: options.rtcManager });
    this.errorListener = options.errorListener ?? (() => {});
    this.remoteStreamListener = options.remoteStreamListener ?? (() => {});
    this.generationTimeoutMs = options.generationTimeoutMs ?? 30_000;

    // RTC 事件监听权归传输层：房间消息交给房间控制器组包分发。
    this.rtcManager.setEventListener({
      onRemoteVideoStatistics: (statistics) => {
        const userID = this.state.activeRemoteStream?.userID;
        this.remoteVideoStatisticsListener?.(
          userID ? statistics.find((item) => item.userID === userID) : undefined,
        );
      },
      onLocalVideoStatistics: (statistics) => {
        if (this.state.localVideoPublished) {
          this.localVideoStatisticsListener?.(statistics);
        }
      },
      onCustomMessageReceived: (senderUserID, message) => {
        this.roomController.handleIncomingMessage(senderUserID, message);
      },
      onRemoteVideoPublished: (userID, published) => {
        void this.handleRemoteVideoPublished(userID, published);
      },
    });
  }

  /** 当前是否存在正在启动或已经运行的生成任务。 */
  get hasGenerationTask(): boolean {
    return this.state.generationTaskID !== undefined;
  }

  /** 设置本地主视频流统计监听器，不改变 RTC 事件监听权。 */
  setLocalVideoStatisticsListener(listener?: VideoStatisticsListener): void {
    this.localVideoStatisticsListener = listener;
  }

  /** 监听当前实际生成结果流的统计，不按会话下发的 botID 猜测结果流身份。 */
  setRemoteVideoStatisticsListener(listener?: RemoteVideoStatisticsListener): void {
    this.remoteVideoStatisticsListener = listener;
  }

  /** 当前远端生成音频播放音量，取值范围为 `0...1`。 */
  get remoteAudioVolume(): number {
    return this.remoteAudioVolumePercentage / 100;
  }

  /** 设置远端生成音频播放音量，并应用到所有已订阅的远端音频。 */
  setRemoteAudioVolume(volume: number): void {
    const rtcVolume = Math.min(Math.max(Math.round(volume * 100), 0), 100);
    for (const userID of [...this.state.subscribedRemoteAudioUserIDs].sort()) {
      this.rtcManager.setRemoteAudioVolume(rtcVolume, userID);
    }
    this.remoteAudioVolumePercentage = rtcVolume;
  }

  /**
   * 按视频格式配置本地视频编码参数（码率区间与编码策略）。
   *
   * @throws 格式无效、码率区间无效或 RTC 配置失败时抛出错误。
   */
  async setVideoEncoderConfig(videoFormat: RealtimeVideoFormat): Promise<void> {
    await this.encodingController.configure(videoFormat);
  }

  /**
   * 加入 RTC 房间并发布本地媒体流。
   *
   * @throws 连接已取消，或 RTC 进房、房间配置与本地流发布失败时抛出错误。
   */
  async connect(
    connection: RealtimeSessionConnection,
    includeLocalAudio: boolean,
    ensureActive: () => void,
  ): Promise<void> {
    await this.roomController.join(connection, ensureActive);
    ensureActive();
    this.configureRoom({ roomID: connection.roomID, botID: connection.botID });
    XmaxLogger.stream.info(
      () =>
        `RTC 房间已配置 (RTC Room Configured)\n` +
        `└─ roomID: ${connection.roomID}, botID: ${connection.botID ?? "(未设置)"}`,
    );
    await this.publishLocalStream(includeLocalAudio);
  }

  /** 清理生成状态、本地发布和远端订阅，并离开当前 RTC 房间。 */
  async disconnect(): Promise<void> {
    await this.resetStream();
    await this.roomController.leave();
  }

  /**
   * 建立生成任务并发送开始信令。
   *
   * @returns 等待远端结果流确认的 Promise。
   * @throws 任务标识无效、RTC 房间未就绪、已有生成任务，或开始信令
   * 发送失败时同步抛出错误。
   */
  beginGeneration(options: StreamGenerationOptions): Promise<void> {
    const taskID = options.taskID.trim();
    if (!taskID) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Realtime generation task ID cannot be empty",
      );
    }
    if (!this.state.roomID) {
      throw new XmaxError(XmaxErrorCode.rtcError, "RTC room is not configured");
    }
    if (this.state.generationTaskID) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Realtime generation is already active",
      );
    }

    let resolve!: () => void;
    let reject!: (error: XmaxError) => void;
    const confirmation = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const waiter: GenerationWaiter = {
      taskID,
      resolve,
      reject,
      confirmationPending: false,
      timeoutTimer: setTimeout(() => {
        this.rejectGenerationStart(
          taskID,
          new XmaxError(
            XmaxErrorCode.timeout,
            "Realtime generation start timed out",
          ),
        );
      }, this.generationTimeoutMs),
    };
    this.state.generationTaskID = taskID;
    this.state.generationWaiter = waiter;

    try {
      this.roomController.startGeneration({
        taskID,
        videoFormat: options.videoFormat,
        targetSize: options.targetSize,
        context: options.context,
      });
    } catch (error) {
      const mapped = XmaxError.from(error);
      this.state.generationTaskID = undefined;
      this.rejectGenerationStart(taskID, mapped);
      try {
        this.roomController.stopGeneration(taskID);
      } catch {
        // 开始信令发送失败后的停止信令失败不影响错误返回。
      }
      throw mapped;
    }
    return confirmation;
  }

  /**
   * 在远端首帧已经可显示后订阅当前生成流的音频。
   *
   * @throws 当前生成流尚未确认，或 RTC 音量和订阅配置失败时抛出错误。
   */
  async activateRemoteAudio(): Promise<void> {
    const remoteStream = this.state.generationTaskID
      ? this.state.activeRemoteStream
      : undefined;
    if (!remoteStream) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Remote generation audio stream is unavailable",
      );
    }
    await this.subscribeRemoteAudio(remoteStream.userID);
  }

  /**
   * 发送生成条件变更信令。
   *
   * @throws RTC 房间未就绪或条件变更信令发送失败时抛出错误。
   */
  updateGeneration(options: StreamGenerationOptions): void {
    try {
      this.roomController.changeGenerationCondition({
        taskID: options.taskID,
        videoFormat: options.videoFormat,
        targetSize: options.targetSize,
        context: options.context,
      });
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /**
   * 调整当前生成任务的回传尺寸，不重启生成。
   *
   * @throws 操作已取消、房间未就绪或信令发送失败时抛出错误。
   */
  changeTargetSize(
    taskID: string,
    targetSize: RoomEventTargetSize,
    ensureActive: () => void,
  ): void {
    try {
      this.roomController.changeTargetSize({ taskID, targetSize, ensureActive });
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /**
   * 停止生成任务并清理远端结果流；任务标识为空字符串时停止当前任务。
   *
   * @throws RTC 停止信令发送失败时抛出错误。
   */
  async stopGeneration(taskID: string): Promise<void> {
    const stoppedTaskID = await this.stopStreamGeneration(taskID);
    if (taskID && !stoppedTaskID) {
      return;
    }
    try {
      this.roomController.stopGeneration(stoppedTaskID);
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /**
   * 发送生成任务的交互轨迹；空数组会被忽略。
   *
   * @throws RTC 房间未就绪或轨迹信令发送失败时抛出错误。
   */
  sendTracks(taskID: string, points: RealtimePoint[]): void {
    try {
      this.roomController.sendTracks(taskID, points);
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /** 设置房间业务消息监听器，传入空值时清除监听器。 */
  setRoomListener(listener?: RoomListener): void {
    this.roomController.setListener(listener);
  }

  /** 配置当前房间；已有发布、订阅或生成任务时拒绝重新配置。 */
  private configureRoom(options: { roomID: string; botID?: string }): void {
    const roomID = options.roomID.trim();
    const botID = options.botID?.trim() ?? "";
    if (!roomID) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "RTC room ID cannot be empty",
      );
    }
    if (
      this.state.localVideoPublished ||
      this.state.localAudioPublished ||
      this.state.subscribedRemoteUserIDs.size > 0 ||
      this.state.generationTaskID
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Reset the current RTC room before configuring another one",
      );
    }
    this.state.roomID = roomID;
    this.state.botID = botID;
  }

  /** 发布本地视频，按需发布本地音频；音频发布失败时回滚视频发布。 */
  private async publishLocalStream(includeAudio: boolean): Promise<void> {
    if (!this.state.roomID) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Configure an RTC room before publishing the local stream",
      );
    }
    let publishedVideoInOperation = false;
    try {
      if (!this.state.localVideoPublished) {
        await this.rtcManager.publishLocalVideo();
        this.state.localVideoPublished = true;
        publishedVideoInOperation = true;
      }
      if (includeAudio && !this.state.localAudioPublished) {
        await this.rtcManager.publishLocalAudio();
        this.state.localAudioPublished = true;
      }
    } catch (error) {
      if (publishedVideoInOperation) {
        await this.rollbackLocalVideoPublication();
      }
      throw XmaxError.from(error);
    }
  }

  /** 处理远端视频发布状态变化：按机器人标识过滤后订阅或清理。 */
  private async handleRemoteVideoPublished(
    userID: string,
    published: boolean,
  ): Promise<void> {
    const trimmedUserID = userID.trim();
    if (!trimmedUserID) {
      return;
    }
    XmaxLogger.stream.info(
      () =>
        `远端视频发布状态变化 (Remote Video Publication Changed)\n` +
        `└─ userID: ${trimmedUserID}, published: ${published}`,
    );
    if (!this.state.roomID) {
      return;
    }
    if (this.state.botID && this.state.botID !== trimmedUserID) {
      // 会话下发的机器人标识与实际发布者不一致时，若当前有生成任务在
      // 等待确认或运行中，仍接受该发布者（房间为会话独占，除本端外
      // 只有生成机器人会推流）。
      if (this.state.generationTaskID === undefined) {
        XmaxLogger.stream.warning(
          () =>
            `忽略非目标机器人的远端视频 (Ignored Remote Video from Non-Bot User)\n` +
            `└─ userID: ${trimmedUserID}, botID: ${this.state.botID}`,
        );
        return;
      }
      XmaxLogger.stream.warning(
        () =>
          `远端视频发布者与会话下发的机器人标识不一致，按生成结果流接受 (Accepted Remote Video Despite Bot ID Mismatch)\n` +
          `└─ userID: ${trimmedUserID}, botID: ${this.state.botID}`,
      );
    }

    if (published) {
      await this.subscribeRemoteVideo(trimmedUserID);
      return;
    }

    this.state.subscribedRemoteUserIDs.delete(trimmedUserID);
    if (this.state.activeRemoteStream?.userID === trimmedUserID) {
      await this.unsubscribeRemoteAudio(trimmedUserID);
      this.state.activeRemoteStream = undefined;
      this.clearRemoteStream();
    }
  }

  /** 订阅远端视频并在成功后就绪或确认生成任务。 */
  private async subscribeRemoteVideo(userID: string): Promise<void> {
    if (this.state.subscribedRemoteUserIDs.has(userID)) {
      return;
    }
    try {
      const track = await this.rtcManager.subscribeRemoteVideo(userID, true);
      if (!track) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "Remote video track is not available",
        );
      }
      // 订阅期间连接可能已被重置。
      if (!this.state.roomID) {
        return;
      }
      this.state.subscribedRemoteUserIDs.add(userID);
      XmaxLogger.stream.info(
        () =>
          `远端视频订阅成功 (Remote Video Subscribed)\n` +
          `└─ userID: ${userID}`,
      );
      this.confirmOrUpdateRemoteStream(userID, track);
    } catch (error) {
      const mapped = XmaxError.from(error);
      const pendingTaskID = this.state.generationWaiter
        ? this.state.generationTaskID
        : undefined;
      if (pendingTaskID) {
        this.rejectGenerationStart(pendingTaskID, mapped);
      } else {
        this.errorListener(mapped);
      }
    }
  }

  /** 订阅成功后就绪远端流：有待确认的生成任务时确认它，否则更新当前绑定。 */
  private confirmOrUpdateRemoteStream(
    userID: string,
    track: MediaStreamTrack,
  ): void {
    const waiter = this.state.generationWaiter;
    const taskID = this.state.generationTaskID;
    const stream = new RemoteStream({ roomID: this.state.roomID, userID });

    if (waiter && taskID) {
      if (waiter.confirmationPending) {
        return;
      }
      waiter.confirmationPending = true;
      try {
        this.remoteStreamListener({ stream, videoTrack: track });
        if (this.state.generationTaskID === taskID) {
          this.state.activeRemoteStream = stream;
        }
      } catch (error) {
        this.rejectGenerationStart(taskID, XmaxError.from(error));
        return;
      }
      this.resolveGenerationStart(taskID);
      return;
    }

    // 生成已确认后机器人重新发布：更新绑定与当前远端流。
    if (taskID) {
      try {
        this.remoteStreamListener({ stream, videoTrack: track });
        if (this.state.generationTaskID === taskID) {
          this.state.activeRemoteStream = stream;
        }
      } catch (error) {
        this.errorListener(XmaxError.from(error));
      }
    }
  }

  /** 订阅远端音频：先应用当前音量再订阅。 */
  private async subscribeRemoteAudio(userID: string): Promise<void> {
    if (this.state.subscribedRemoteAudioUserIDs.has(userID)) {
      return;
    }
    this.rtcManager.setRemoteAudioVolume(this.remoteAudioVolumePercentage, userID);
    await this.rtcManager.subscribeRemoteAudio(userID, true);
    this.state.subscribedRemoteAudioUserIDs.add(userID);
  }

  /** 取消订阅远端音频；失败仅记录日志。 */
  private async unsubscribeRemoteAudio(userID: string): Promise<void> {
    if (!this.state.subscribedRemoteAudioUserIDs.delete(userID)) {
      return;
    }
    await this.performCleanup(
      "取消订阅 RTC 远端音频失败 (Failed to Unsubscribe from RTC Remote Audio)",
      () => this.rtcManager.subscribeRemoteAudio(userID, false),
    );
  }

  /**
   * 停止当前生成任务：拒绝等待器、清理远端流与音频订阅。
   *
   * @returns 被停止的任务标识；无匹配任务时返回空字符串。
   */
  private async stopStreamGeneration(
    taskID: string,
    reason = "Realtime generation start cancelled",
  ): Promise<string> {
    const currentTaskID = this.state.generationTaskID ?? "";
    if (taskID && taskID !== currentTaskID) {
      return "";
    }

    const waiter = this.state.generationWaiter;
    const remoteAudioUserIDs = [...this.state.subscribedRemoteAudioUserIDs];
    this.state.generationTaskID = undefined;
    this.state.generationWaiter = undefined;
    this.state.activeRemoteStream = undefined;
    this.state.subscribedRemoteAudioUserIDs.clear();

    if (waiter) {
      clearTimeout(waiter.timeoutTimer);
      waiter.reject(new XmaxError(XmaxErrorCode.cancelled, reason));
    }
    for (const userID of remoteAudioUserIDs.sort()) {
      await this.performCleanup(
        "取消订阅 RTC 远端音频失败 (Failed to Unsubscribe from RTC Remote Audio)",
        () => this.rtcManager.subscribeRemoteAudio(userID, false),
      );
    }
    this.clearRemoteStream();
    return currentTaskID;
  }

  /** 复位传输层：停止生成、取消全部远端订阅、取消本地发布。 */
  private async resetStream(): Promise<void> {
    await this.stopStreamGeneration("");
    const previousState = this.state;
    this.state = makeInitialState();

    for (const userID of [...previousState.subscribedRemoteUserIDs].sort()) {
      await this.performCleanup(
        "取消订阅 RTC 远端视频失败 (Failed to Unsubscribe from RTC Remote Video)",
        async () => {
          await this.rtcManager.subscribeRemoteVideo(userID, false);
        },
      );
    }
    if (previousState.localAudioPublished) {
      await this.performCleanup(
        "取消发布 RTC 本地音频失败 (Failed to Unpublish RTC Local Audio)",
        () => this.rtcManager.unpublishLocalAudio(),
      );
    }
    if (previousState.localVideoPublished) {
      await this.performCleanup(
        "取消发布 RTC 本地视频失败 (Failed to Unpublish RTC Local Video)",
        () => this.rtcManager.unpublishLocalVideo(),
      );
    }
  }

  /** 确认生成开始：清理等待器并兑现确认 Promise。 */
  private resolveGenerationStart(taskID: string): void {
    const waiter = this.state.generationWaiter;
    if (this.state.generationTaskID !== taskID || waiter?.taskID !== taskID) {
      return;
    }
    this.state.generationWaiter = undefined;
    clearTimeout(waiter.timeoutTimer);
    waiter.resolve();
  }

  /** 拒绝生成开始：清理等待器并拒绝确认 Promise。 */
  private rejectGenerationStart(taskID: string, error: XmaxError): void {
    const waiter = this.state.generationWaiter;
    if (this.state.generationTaskID !== taskID || waiter?.taskID !== taskID) {
      return;
    }
    this.state.generationWaiter = undefined;
    clearTimeout(waiter.timeoutTimer);
    waiter.reject(error);
  }

  /** 通知渲染层清理远端生成流；失败仅记录日志。 */
  private clearRemoteStream(): void {
    this.remoteVideoStatisticsListener?.(undefined);
    try {
      this.remoteStreamListener(null);
    } catch (error) {
      XmaxLogger.stream.error(
        () =>
          `清理 RTC 远端生成流失败 (Failed to Clean Up RTC Remote Generation Stream)\n` +
          `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
      );
    }
  }

  /** 回滚本地视频发布；失败仅记录日志。 */
  private async rollbackLocalVideoPublication(): Promise<void> {
    await this.performCleanup(
      "回滚 RTC 本地视频发布失败 (Failed to Roll Back RTC Local Video Publication)",
      async () => {
        await this.rtcManager.unpublishLocalVideo();
        this.state.localVideoPublished = false;
      },
    );
  }

  /** 执行清理动作；失败仅记录日志。 */
  private async performCleanup(
    title: string,
    action: () => Promise<void> | void,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      XmaxLogger.stream.error(
        () =>
          `${title}\n` +
          `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
      );
    }
  }
}
