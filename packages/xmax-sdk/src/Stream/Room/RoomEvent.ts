import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { RuntimeInfo } from "../../Foundation/Runtime/RuntimeInfo";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeExtraParams } from "../../Service/Realtime/RealtimeExtraParams";
import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";

/**
 * 生成或回传使用的整数像素尺寸。
 */
export interface RoomEventTargetSize {
  width: number;
  height: number;
}

/**
 * 生成条件类信令的公共参数。
 */
export interface RoomEventGenerationOptions {
  /**
   * 业务用户标识。
   */
  userID: string;

  /**
   * 当前生成任务标识。
   */
  taskID: string;

  /**
   * 模型生成使用的视频规格。
   */
  videoFormat: RealtimeVideoFormat;

  /**
   * 当前生成条件。
   */
  context: RealtimeContext;

  /** 服务端生成后的回传尺寸，缺省时不发送；网络视频 start 默认使用生成尺寸。 */
  targetSize?: RoomEventTargetSize;

  /** 是否回贴原始人脸，默认 false。 */
  faceRestoration?: boolean;

  /** 合并到本次生成信令的 params，不缓存。 */
  extraParams?: RealtimeExtraParams;
}

/**
 * 生成 SDK 与 RTC 房间之间传输的结构化事件消息。
 *
 * 每条消息在业务字段外附带 `runtime` 运行环境信息；
 * 编码失败时抛出 `internalError`。
 */
export class RoomEvent {
  /**
   * 生成开始信令。
   *
   * @param options.userID 业务用户标识。
   * @param options.taskID 当前生成任务标识。
   * @param options.videoFormat 模型生成使用的视频规格。
   * @param options.context 本次生成条件。
   * @param options.targetSize 回传尺寸，缺省时不发送；网络视频默认使用生成尺寸。
   * @param options.minimumBitrate 服务端回传的最低码率，单位为 kbps。
   * @param options.maximumBitrate 服务端回传的最高码率，单位为 kbps。
   * @param options.mirror 是否由后端镜像输入画面，默认 false。
   * @param options.faceRestoration 是否回贴原始人脸，默认 false。
   * @param options.extraParams 已校验的本次扩展参数，合并到 params。
   * @returns 序列化后的 start 房间消息。
   */
  static start(options: {
    userID: string;
    taskID: string;
    videoFormat: RealtimeVideoFormat;
    context: RealtimeContext;
    targetSize?: RoomEventTargetSize;
    minimumBitrate: number;
    maximumBitrate: number;
    mirror?: boolean;
    faceRestoration?: boolean;
    extraParams?: RealtimeExtraParams;
  }): string {
    return RoomEvent.encode({
      event: "start",
      params: {
        ...RoomEvent.generationParameters(options),
        min_bitrate: options.minimumBitrate,
        max_bitrate: options.maximumBitrate,
        mirror: options.mirror ?? false,
        ...(options.context.referenceVideo && {
          ref_video_path: options.context.referenceVideo.path,
          sample_method: options.context.referenceVideo.sampleMethod,
          target_size: [
            options.targetSize?.width ?? options.videoFormat.width,
            options.targetSize?.height ?? options.videoFormat.height,
          ],
        }),
      },
      user_id: options.userID,
      uid: options.taskID,
      ...(options.context.referenceVideo && { session_uid: options.taskID }),
    });
  }

  /**
   * 生成条件变更信令。
   *
   * @param options.userID 业务用户标识。
   * @param options.taskID 当前生成任务标识。
   * @param options.videoFormat 模型生成使用的视频规格。
   * @param options.context 本次生成条件。
   * @param options.targetSize 回传尺寸，缺省时不发送。
   * @param options.faceRestoration 是否回贴原始人脸，默认 false。
   * @param options.extraParams 已校验的本次扩展参数，合并到 params。
   * @returns 序列化后的 change_condition 房间消息。
   */
  static changeCondition(options: RoomEventGenerationOptions): string {
    return RoomEvent.encode({
      event: "change_condition",
      params: RoomEvent.generationParameters(options),
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /**
   * 回传尺寸和码率范围调整信令，码率单位为 kbps。
   */
  static changeTargetSize(options: {
    userID: string;
    taskID: string;
    targetSize: RoomEventTargetSize;
    minimumBitrate: number;
    maximumBitrate: number;
  }): string {
    return RoomEvent.encode({
      event: "change_target_size",
      params: {
        min_bitrate: options.minimumBitrate,
        max_bitrate: options.maximumBitrate,
        target_size: [
          Math.round(options.targetSize.width),
          Math.round(options.targetSize.height),
        ],
      },
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /**
   * 生成停止信令。
   */
  static stop(options: { userID: string; taskID: string }): string {
    return RoomEvent.encode({
      event: "stop",
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /**
   * 交互轨迹信令。
   */
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

  /**
   * 房间心跳信令。
   */
  static heartbeat(options: { userID: string }): string {
    return RoomEvent.encode({
      event: "heartbeat",
      user_id: options.userID,
    });
  }

  /**
   * 组装生成条件参数，包含人脸回贴配置及本次扩展参数。
   *
   * @param options 本次生成条件类信令的参数。
   * @returns start 与 change_condition 共用的 params 字段。
   */
  private static generationParameters(
    options: RoomEventGenerationOptions,
  ): Record<string, unknown> {
    return {
      model: "default",
      face_replace: options.faceRestoration ?? false,
      size: [options.videoFormat.width, options.videoFormat.height],
      target_size: options.targetSize
        ? [
            Math.round(options.targetSize.width),
            Math.round(options.targetSize.height),
          ]
        : undefined,
      prompt: options.context.prompt,
      ref_image_path: options.context.referencePath,
      ...options.extraParams,
    };
  }

  /**
   * 业务字段外加 `runtime` 运行环境信息并序列化为 JSON 文本。
   */
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
