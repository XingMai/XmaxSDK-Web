import type { XmaxError } from "../../Foundation/Errors/XmaxError";

/**
 * 单次录制的最终事件类型。
 */
export enum RealtimeRecordingEventType {
  completed = "completed",
  interrupted = "interrupted",
  failed = "failed",
}

/**
 * 已完成文件封装的录制结束原因。
 */
export enum RealtimeRecordingFinishReason {
  durationLimit = "durationLimit",
  generationEnded = "generationEnded",
  restarted = "restarted",
  mediaInterrupted = "mediaInterrupted",
}

/**
 * 已封装的录制文件；格式由 blob.type 指示，不保证为 MP4。
 */
export interface RealtimeRecordingResult {
  /**
   * 可供保存、上传或预览的完整文件。
   */
  readonly blob: Blob;

  /**
   * 录制期间是否接入过未静音的远端音频轨；不表示内容一定有声音。
   */
  readonly hasAudio: boolean;

  /**
   * 录制结束原因。
   */
  readonly reason: RealtimeRecordingFinishReason;
}

/**
 * 录制终态；成功封装的提前结束返回 interrupted，无法提供有效文件返回 failed。
 */
export type RealtimeRecordingEvent =
  | {
      type: RealtimeRecordingEventType.completed | RealtimeRecordingEventType.interrupted;
      taskID: string;
      result: RealtimeRecordingResult;
    }
  | {
      type: RealtimeRecordingEventType.failed;
      taskID: string;
      error: XmaxError;
    };

/**
 * 每次录制交付一次最终事件，监听器异常不影响实时生成。
 */
export type RealtimeRecordingListener = (event: RealtimeRecordingEvent) => void;
