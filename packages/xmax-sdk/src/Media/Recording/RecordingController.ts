import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RecordingTracks } from "../../Foundation/Media/Recording/RecordingTracks";
import {
  RealtimeRecordingEventType,
  RealtimeRecordingFinishReason,
  type RealtimeRecordingEvent,
  type RealtimeRecordingListener,
} from "../../Service/Realtime/RealtimeRecordingEvent";

/**
 * 单次录制资源。旧任务封装时仍持有自己的资源，不与新任务混用。
 */
interface RecordingSession {
  /**
   * 任务与借用的远端轨道
   */
  taskID: string;
  readTracks: () => RecordingTracks | undefined;
  videoTrack: MediaStreamTrack;

  /**
   * 首帧探测与独立音频图
   */
  video?: HTMLVideoElement;
  frameCallback?: number;
  audioContext?: AudioContext;
  audioDestination?: MediaStreamAudioDestinationNode;
  silenceSource?: ConstantSourceNode;
  audioSource?: MediaStreamAudioSourceNode;
  audioTrack?: MediaStreamTrack;

  /**
   * 编码数据与最终结果状态
   */
  recorder?: MediaRecorder;
  chunks: Blob[];
  bytes: number;
  hasAudio: boolean;
  stopping: boolean;
  finished: boolean;
  reason: RealtimeRecordingFinishReason;
  error?: XmaxError;

  /**
   * 定时任务与共享收尾结果
   */
  timer?: ReturnType<typeof setTimeout>;
  monitor?: ReturnType<typeof setInterval>;
  finalizationTimer?: ReturnType<typeof setTimeout>;
  completion: Promise<void>;
  resolve: () => void;
}

/**
 * 独立录制远端原始音视频；仅显式启动时分配浏览器资源，不依赖渲染视图。
 * 单次约 15 秒，后台调度可能延迟停止；不做精确裁剪。
 */
export class RecordingController {
  /**
   * 录制资源上限
   */
  private static readonly durationMs = 15_000;
  private static readonly maximumBytes = 64 * 1024 * 1024;
  private static readonly preparationTimeoutMs = 10_000;
  private static readonly finalizationTimeoutMs = 5_000;

  /**
   * 任务资源与结果监听
   */
  private session?: RecordingSession;
  private listener?: RealtimeRecordingListener;

  /**
   * 设置统一结果监听器；传入 undefined 清除，不停止正在进行的录制。
   */
  setListener(listener?: RealtimeRecordingListener): void {
    this.listener = listener;
  }

  /**
   * 开始准备当前任务的录制；准备和录制失败只通过独立事件通知。
   */
  start(taskID: string, readTracks: () => RecordingTracks | undefined): void {
    if (this.session && !this.session.finished) {
      void this.stop(RealtimeRecordingFinishReason.restarted);
    }

    try {
      const tracks = readTracks();
      if (!tracks || tracks.videoTrack.readyState === "ended") {
        throw new XmaxError(XmaxErrorCode.mediaError, "Remote video is unavailable for recording");
      }
      if (typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") {
        throw new XmaxError(XmaxErrorCode.mediaError, "Audio/video recording is not supported by this browser");
      }

      let resolve!: () => void;
      const completion = new Promise<void>(done => { resolve = done; });
      const session: RecordingSession = {
        taskID, readTracks, videoTrack: tracks.videoTrack,
        chunks: [], bytes: 0, hasAudio: false, stopping: false, finished: false,
        reason: RealtimeRecordingFinishReason.durationLimit, completion, resolve,
      };
      this.session = session;
      session.timer = setTimeout(() => {
        this.fail(session, new XmaxError(XmaxErrorCode.timeout, "Timed out preparing remote recording"));
      }, RecordingController.preparationTimeoutMs);

      void this.prepare(session).catch(error => this.fail(session, XmaxError.from(error)));
    } catch (error) {
      this.reportFailure(taskID, XmaxError.from(error));
    }
  }

  /**
   * 请求收尾并等待最终数据；重复停止共享完成结果，且绝不停止 RTC 原始轨道。
   */
  stop(reason: RealtimeRecordingFinishReason): Promise<void> {
    const session = this.session;
    if (!session) {
      return Promise.resolve();
    }

    this.stopSession(session, reason);
    return session.completion;
  }

  /**
   * 不支持的录制请求使用同一错误出口，不改变生成生命周期。
   */
  reportFailure(taskID: string, error: XmaxError): void {
    this.emit({ type: RealtimeRecordingEventType.failed, taskID, error });
  }

  /**
   * 使用固定音频输出轨处理晚到的音频；不在 MediaRecorder 运行中增删轨道。
   */
  private async prepare(session: RecordingSession): Promise<void> {
    const context = new AudioContext();
    session.audioContext = context;
    session.audioDestination = context.createMediaStreamDestination();

    // 没有输入节点时部分浏览器不产生音频包，持续零输入保证晚到音频前的静音时间线。
    const silence = context.createConstantSource();
    silence.offset.value = 0;
    silence.connect(session.audioDestination);
    silence.start();
    session.silenceSource = silence;

    await context.resume();
    if (session.stopping || session.finished) {
      return;
    }
    if (context.state !== "running") {
      throw new XmaxError(XmaxErrorCode.mediaError, "Browser did not allow recording audio to start");
    }

    this.updateAudio(session);
    const video = document.createElement("video");
    session.video = video;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([session.videoTrack]);

    // 独立探测首帧，不要求接入方挂载 XmaxVideoView，也不读取 UI 插帧输出。
    const ready = () => {
      if (!session.stopping && !session.finished && video.readyState >= 2) {
        this.beginRecording(session);
      }
    };
    if (typeof video.requestVideoFrameCallback === "function") {
      session.frameCallback = video.requestVideoFrameCallback(ready);
    } else {
      video.onloadeddata = ready;
      video.onplaying = ready;
    }
    video.onerror = () => this.fail(session, new XmaxError(XmaxErrorCode.mediaError, "Cannot read remote recording video"));
    try {
      await video.play();
    } catch (error) {
      // 首帧回调可能先完成并释放探测元素，此时 play 的 AbortError 不代表录制失败。
      if (!session.recorder && !session.stopping && !session.finished) {
        throw error;
      }
    }

    if (typeof video.requestVideoFrameCallback !== "function") {
      ready();
    }
  }

  /**
   * 首帧可用后启动单个音视频录制器，计时不包含连接和媒体准备阶段。
   */
  private beginRecording(session: RecordingSession): void {
    if (session.recorder || session.stopping || session.finished) {
      return;
    }

    try {
      session.hasAudio = false;
      this.updateAudio(session);
      const stream = new MediaStream([session.videoTrack, ...session.audioDestination!.stream.getAudioTracks()]);
      const mimeType = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp8,opus", "video/mp4", "video/webm"]
        .find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) {
        throw new XmaxError(XmaxErrorCode.mediaError, "No supported audio/video recording format");
      }
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 });
      session.recorder = recorder;
      recorder.ondataavailable = event => {
        if (session.finished || session.error || !event.data.size) {
          return;
        }
        if (session.bytes + event.data.size > RecordingController.maximumBytes) {
          this.fail(session, new XmaxError(XmaxErrorCode.mediaError, "Recording exceeded the memory limit"));
          return;
        }
        session.chunks.push(event.data);
        session.bytes += event.data.size;
      };
      recorder.onerror = () => {
        // 编码器报错时无法保证已有分片完整，不把非空 Blob 当成可播放文件。
        this.fail(session, new XmaxError(XmaxErrorCode.mediaError, "Remote recording encoder failed"));
      };
      recorder.onstop = () => {
        if (!session.stopping) {
          session.reason = RealtimeRecordingFinishReason.mediaInterrupted;
        }
        this.finish(session);
      };
      recorder.start(1_000);

      clearTimeout(session.timer);
      session.timer = setTimeout(() => this.stopSession(session, RealtimeRecordingFinishReason.durationLimit), RecordingController.durationMs);
      session.monitor = setInterval(() => {
        try {
          const tracks = session.readTracks();
          if (!tracks || tracks.videoTrack !== session.videoTrack || session.videoTrack.readyState === "ended") {
            this.stopSession(session, RealtimeRecordingFinishReason.mediaInterrupted);
          } else if (session.audioContext?.state !== "running") {
            this.fail(session, new XmaxError(XmaxErrorCode.mediaError, "Recording audio context was suspended"));
          } else {
            this.updateAudio(session);
          }
        } catch (error) {
          this.fail(session, XmaxError.from(error));
        }
      }, 100);
      this.releaseVideoProbe(session);
    } catch (error) {
      this.fail(session, XmaxError.from(error));
    }
  }

  /**
   * 轮询仅在录制期间运行；接入原始音频，不连接扬声器，不受播放音量影响。
   */
  private updateAudio(session: RecordingSession): void {
    const track = session.readTracks()?.audioTrack;
    const liveTrack = track?.readyState === "live" ? track : undefined;
    if (liveTrack !== session.audioTrack) {
      session.audioSource?.disconnect();
      session.audioSource = undefined;
      session.audioTrack = liveTrack;
      if (liveTrack) {
        session.audioSource = session.audioContext!.createMediaStreamSource(new MediaStream([liveTrack]));
        session.audioSource.connect(session.audioDestination!);
      }
    }
    if (liveTrack && !liveTrack.muted && liveTrack.enabled) {
      session.hasAudio = true;
    }
  }

  /**
   * 标记失败并尽力停止编码；任何错误都不能冒泡到实时生成。
   */
  private fail(session: RecordingSession, error: XmaxError): void {
    if (session.finished) {
      return;
    }
    session.error ??= error;
    this.stopSession(session, RealtimeRecordingFinishReason.mediaInterrupted);
  }

  /**
   * 保留最后一个 dataavailable，等待 stop 后再封装；异常路径有收尾超时保护。
   */
  private stopSession(session: RecordingSession, reason: RealtimeRecordingFinishReason): void {
    if (session.stopping || session.finished) {
      return;
    }
    session.stopping = true;
    session.reason = reason;
    clearTimeout(session.timer);
    clearInterval(session.monitor);
    this.releaseVideoProbe(session);

    if (!session.recorder || session.recorder.state === "inactive") {
      this.finish(session);
      return;
    }
    session.finalizationTimer = setTimeout(() => {
      session.error ??= new XmaxError(XmaxErrorCode.timeout, "Timed out finalizing remote recording");
      this.finish(session);
    }, RecordingController.finalizationTimeoutMs);
    try {
      session.recorder.stop();
    } catch (error) {
      session.error ??= XmaxError.from(error);
      this.finish(session);
    }
  }

  /**
   * 一次性交付结果并释放所有自有资源，不保留文件副本。
   */
  private finish(session: RecordingSession): void {
    if (session.finished) {
      return;
    }
    session.finished = true;
    clearTimeout(session.timer);
    clearTimeout(session.finalizationTimer);
    clearInterval(session.monitor);
    this.releaseVideoProbe(session);

    const blob = new Blob(session.chunks, { type: session.recorder?.mimeType ?? session.chunks[0]?.type });
    session.chunks = [];
    session.audioSource?.disconnect();
    session.silenceSource?.stop();
    session.silenceSource?.disconnect();
    session.audioDestination?.stream.getTracks().forEach(track => track.stop());
    if (session.audioContext && session.audioContext.state !== "closed") {
      void session.audioContext.close().catch(() => {});
    }
    if (session.recorder) {
      session.recorder.ondataavailable = null;
      session.recorder.onerror = null;
      session.recorder.onstop = null;
    }
    if (this.session === session) {
      this.session = undefined;
    }

    if (session.error || !blob.size) {
      this.reportFailure(session.taskID, session.error ?? new XmaxError(XmaxErrorCode.mediaError, "Recording ended without usable media"));
    } else {
      this.emit({
        type: session.reason === RealtimeRecordingFinishReason.durationLimit
          ? RealtimeRecordingEventType.completed : RealtimeRecordingEventType.interrupted,
        taskID: session.taskID,
        result: { blob, hasAudio: session.hasAudio, reason: session.reason },
      });
    }
    session.resolve();
  }

  /**
   * 释放首帧探测元素；srcObject 原始轨道不调用 stop。
   */
  private releaseVideoProbe(session: RecordingSession): void {
    const video = session.video;
    if (!video) {
      return;
    }
    if (session.frameCallback !== undefined) {
      video.cancelVideoFrameCallback(session.frameCallback);
    }
    video.onloadeddata = null;
    video.onplaying = null;
    video.onerror = null;
    video.pause();
    video.srcObject = null;
    session.video = undefined;
  }

  /**
   * 隔离接入方监听器异常，包括异步监听器的 Promise 拒绝。
   */
  private emit(event: RealtimeRecordingEvent): void {
    try {
      void Promise.resolve(this.listener?.(event)).catch(() => {
        XmaxLogger.realtime.warning(() => "Recording listener rejected");
      });
    } catch {
      XmaxLogger.realtime.warning(() => "Recording listener threw an error");
    }
  }
}
