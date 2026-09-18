import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { RealtimeModel } from "../../Core/Realtime/RealtimeModel";
import type { ApiServicing } from "../Network/ApiServicing";
import { RealtimeSession } from "./RealtimeSession";
import { RealtimeSessionConnection } from "./RealtimeSessionConnection";
import type {
  RealtimeSessionHeartbeatHandlers,
  RealtimeSessionServicing,
} from "./RealtimeSessionServicing";

/** 会话接口返回的统一数据。 */
interface SessionPayload {
  sessionUid?: string;
  userUid?: string;
  status?: string;
  modelExtra?: unknown;
  closeReason?: string;
}

/** `modelExtra` 中 TRTC 连接参数的原始字段。 */
interface ConnectionPayload {
  room_id?: string;
  provider?: string;
  rtc_app_id?: string;
  rtc_user_id?: string;
  user_sig?: string;
  private_map_key_with_string_room_id?: string;
  rtc_bot_id?: string;
}

export interface RealtimeSessionServiceOptions {
  /** Xmax API 请求组件。 */
  apiService: ApiServicing;

  /** 心跳间隔（毫秒）；默认 10 秒。 */
  heartbeatIntervalMs?: number;

  /** 心跳等待实现（可替换，测试用）。 */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 管理实时生成会话的创建、心跳维持和关闭。
 *
 * 心跳成功后会把携带最新 RTC 凭据的会话通过 `onRefresh` 回调给
 * 使用方覆盖本地缓存；心跳使用版本号使已停止心跳的迟到结果失效。
 */
export class RealtimeSessionService implements RealtimeSessionServicing {
  // 服务层组件
  private readonly apiService: ApiServicing;

  // 心跳配置
  private readonly heartbeatIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  // 运行状态
  private heartbeatVersion = 0;

  /**
   * 创建实时生成会话 Service。
   *
   * @param options.apiService Xmax API 请求组件。
   * @param options.heartbeatIntervalMs 心跳间隔（毫秒）；默认 10 秒。
   * @param options.sleep 心跳等待实现（可替换，测试用）。
   */
  constructor(options: RealtimeSessionServiceOptions) {
    this.apiService = options.apiService;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /** 创建实时会话并返回 RTC 连接信息。 */
  async createSession(model: RealtimeModel): Promise<RealtimeSession> {
    const payload = await this.apiService.post<SessionPayload>("/session", {
      model,
    });
    return RealtimeSessionService.makeSession(payload, true);
  }

  /** 启动指定会话的周期心跳；重复启动会替换当前心跳。 */
  startHeartbeat(
    sessionID: string,
    handlers: RealtimeSessionHeartbeatHandlers,
  ): void {
    const version = ++this.heartbeatVersion;
    void this.runHeartbeat(version, sessionID, handlers);
  }

  /** 停止当前心跳；已经失效的迟到结果不会再触发回调。 */
  stopHeartbeat(): void {
    this.heartbeatVersion += 1;
  }

  /** 关闭指定实时会话。 */
  async closeSession(sessionID: string): Promise<void> {
    try {
      await this.apiService.delete<Record<string, never>>(
        `/session/${sessionID}`,
      );
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /** 周期心跳：等待 → 请求 → 校验会话活跃并回调刷新；失败时失效版本并回调。 */
  private async runHeartbeat(
    version: number,
    sessionID: string,
    handlers: RealtimeSessionHeartbeatHandlers,
  ): Promise<void> {
    while (this.heartbeatVersion === version) {
      await this.sleep(this.heartbeatIntervalMs);
      if (this.heartbeatVersion !== version) {
        return;
      }
      try {
        const session = await this.heartbeatSession(sessionID);
        if (this.heartbeatVersion !== version) {
          return;
        }
        RealtimeSessionService.ensureSessionActive(session);
        handlers.onRefresh?.(session);
      } catch (error) {
        if (this.heartbeatVersion !== version) {
          return;
        }
        this.heartbeatVersion += 1;
        await handlers.onFailure(sessionID, XmaxError.from(error));
        return;
      }
    }
  }

  /** 发送一次心跳请求并解析会话数据（不要求携带完整连接参数）。 */
  private async heartbeatSession(sessionID: string): Promise<RealtimeSession> {
    const payload = await this.apiService.put<SessionPayload>(
      `/session/${sessionID}/heartbeat`,
    );
    return RealtimeSessionService.makeSession(payload, false);
  }

  /** 校验会话仍处于活跃状态；状态明确非 ACTIVE 时抛出会话错误。 */
  private static ensureSessionActive(session: RealtimeSession): void {
    if (!session.status || session.status === "ACTIVE") {
      return;
    }
    throw new XmaxError(
      XmaxErrorCode.sessionError,
      session.closeReason ?? `Session is no longer active: ${session.status}`,
    );
  }

  /** 由会话接口数据构造会话模型；`requiresConnection` 要求携带完整 RTC 连接参数。 */
  private static makeSession(
    payload: SessionPayload,
    requiresConnection: boolean,
  ): RealtimeSession {
    const sessionID = RealtimeSessionService.nonEmpty(payload.sessionUid);
    if (!sessionID) {
      throw new XmaxError(XmaxErrorCode.sessionError, "Invalid session response");
    }

    const connection = RealtimeSessionService.makeConnection(payload.modelExtra);
    if (requiresConnection && !connection) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "Session does not contain complete RTC join information",
      );
    }

    return new RealtimeSession({
      id: sessionID,
      userID: RealtimeSessionService.nonEmpty(payload.userUid),
      status: RealtimeSessionService.nonEmpty(payload.status),
      connection,
      closeReason: RealtimeSessionService.nonEmpty(payload.closeReason),
    });
  }

  /** 解析 `modelExtra` 中的 TRTC 连接参数；字段不完整或提供方不支持时返回空。 */
  private static makeConnection(
    modelExtra: unknown,
  ): RealtimeSessionConnection | undefined {
    const payload = RealtimeSessionService.decodeConnectionPayload(modelExtra);
    if (!payload) {
      return undefined;
    }

    // 仅支持 TRTC 提供方；provider 缺省时服务端按 vertc 处理，同样不支持。
    if (RealtimeSessionService.nonEmpty(payload.provider) !== "trtc") {
      return undefined;
    }

    const roomID = RealtimeSessionService.nonEmpty(payload.room_id);
    const sdkAppID = RealtimeSessionService.nonEmpty(payload.rtc_app_id);
    const userID = RealtimeSessionService.nonEmpty(payload.rtc_user_id);
    const userSig = RealtimeSessionService.nonEmpty(payload.user_sig);
    const privateMapKey = RealtimeSessionService.nonEmpty(
      payload.private_map_key_with_string_room_id,
    );
    if (!roomID || !sdkAppID || !userID || !userSig || !privateMapKey) {
      return undefined;
    }

    return new RealtimeSessionConnection({
      provider: "trtc",
      roomID,
      sdkAppID,
      userID,
      userSig,
      privateMapKey,
      botID: RealtimeSessionService.nonEmpty(payload.rtc_bot_id),
    });
  }

  /** `modelExtra` 可能为对象或 JSON 字符串，统一解析为连接参数字段。 */
  private static decodeConnectionPayload(
    modelExtra: unknown,
  ): ConnectionPayload | undefined {
    if (typeof modelExtra === "string") {
      try {
        return JSON.parse(modelExtra) as ConnectionPayload;
      } catch {
        return undefined;
      }
    }
    if (typeof modelExtra === "object" && modelExtra !== null) {
      return modelExtra as ConnectionPayload;
    }
    return undefined;
  }

  /** 归一化可选字符串：去除首尾空白后为空时返回 `undefined`。 */
  private static nonEmpty(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
  }
}
