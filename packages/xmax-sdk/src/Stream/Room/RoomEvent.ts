import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { RuntimeInfo } from "../../Foundation/Runtime/RuntimeInfo";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";

/** 生成或回传使用的整数像素尺寸。 */
export interface RoomEventTargetSize {
  width: number;
  height: number;
}

/** 生成条件类信令的公共参数。 */
export interface RoomEventGenerationOptions {
  /** 业务用户标识。 */
  userID: string;

  /** 当前生成任务标识。 */
  taskID: string;

  /** 模型生成使用的视频规格。 */
  videoFormat: RealtimeVideoFormat;

  /** 服务端生成后的回传尺寸；缺省时保持生成尺寸。 */
  targetSize?: RoomEventTargetSize;

  /** 当前生成条件。 */
  context: RealtimeContext;
}

/**
 * 生成 SDK 与 RTC 房间之间传输的结构化事件消息。
 *
 * 每条消息在业务字段外附带 `runtime` 运行环境信息；
 * 编码失败时抛出 `internalError`。
 */
export class RoomEvent {
  /** 生成开始信令。 */
  static start(options: RoomEventGenerationOptions): string {
    return RoomEvent.encode({
      event: "start",
      params: RoomEvent.generationParameters(options),
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /** 生成条件变更信令。 */
  static changeCondition(options: RoomEventGenerationOptions): string {
    return RoomEvent.encode({
      event: "change_condition",
      params: RoomEvent.generationParameters(options),
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /** 回传尺寸调整信令。 */
  static changeTargetSize(options: {
    userID: string;
    taskID: string;
    targetSize: RoomEventTargetSize;
  }): string {
    return RoomEvent.encode({
      event: "change_target_size",
      params: {
        target_size: [
          Math.round(options.targetSize.width),
          Math.round(options.targetSize.height),
        ],
      },
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /** 生成停止信令。 */
  static stop(options: { userID: string; taskID: string }): string {
    return RoomEvent.encode({
      event: "stop",
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /** 交互轨迹信令。 */
  static tracks(options: {
    userID: string;
    taskID: string;
    points: RealtimePoint[];
  }): string {
    return RoomEvent.encode({
      event: "tracks",
      tracks: options.points.map((point) => [point.x, point.y]),
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /** 房间心跳信令。 */
  static heartbeat(options: { userID: string }): string {
    return RoomEvent.encode({
      event: "heartbeat",
      user_id: options.userID,
    });
  }

  /** 生成条件参数：模型、生成尺寸、回传尺寸、文本与参考图路径。 */
  private static generationParameters(
    options: RoomEventGenerationOptions,
  ): Record<string, unknown> {
    return {
      model: "default",
      size: [options.videoFormat.width, options.videoFormat.height],
      target_size: options.targetSize
        ? [
            Math.round(options.targetSize.width),
            Math.round(options.targetSize.height),
          ]
        : undefined,
      prompt: options.context.prompt,
      ref_image_path: options.context.referencePath,
    };
  }

  /** 业务字段外加 `runtime` 运行环境信息并序列化为 JSON 文本。 */
  private static encode(payload: Record<string, unknown>): string {
    try {
      return JSON.stringify({ ...payload, runtime: RuntimeInfo.toJSON() });
    } catch {
      throw new XmaxError(
        XmaxErrorCode.internalError,
        "Failed to encode RTC room event",
      );
    }
  }
}
