import { describe, expect, it } from "vitest";
import { RealtimeModel } from "../src/Core/Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { ApiMethod, type ApiServicing } from "../src/Service/Network/ApiServicing";
import type { RealtimeSession } from "../src/Service/Realtime/RealtimeSession";
import { RealtimeSessionService } from "../src/Service/Realtime/RealtimeSessionService";

const trtcModelExtra = {
  room_id: "100000001",
  bot_name: "bot001",
  user_id: "user-001",
  provider: "trtc",
  rtc_app_id: "1600126360",
  rtc_user_id: "rtc-user-001",
  rtc_bot_id: "bot001",
  user_sig: "sig-v1",
  private_map_key_with_string_room_id: "pmk-v1",
};

class ApiServicingStub implements ApiServicing {
  requests: { method: ApiMethod; path: string; body?: unknown }[] = [];
  postResponses: Array<unknown | Error> = [];
  putResponses: Array<unknown | Error> = [];
  deleteResponses: Array<unknown | Error> = [];

  request<T>(method: ApiMethod, path: string, body?: unknown): Promise<T> {
    this.requests.push({ method, path, body });
    const queue =
      method === ApiMethod.post
        ? this.postResponses
        : method === ApiMethod.put
          ? this.putResponses
          : this.deleteResponses;
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) {
      return Promise.reject(
        new XmaxError(XmaxErrorCode.apiError, `No stubbed response for ${method} ${path}`),
      );
    }
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(next as T);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(ApiMethod.get, path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(ApiMethod.post, path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(ApiMethod.put, path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(ApiMethod.delete, path);
  }
}

function sessionPayload(overrides?: {
  modelExtra?: unknown;
  status?: string;
  closeReason?: string;
}) {
  return {
    sessionUid: "ums-001",
    userUid: "user-001",
    status: overrides?.status ?? "ACTIVE",
    modelExtra: overrides === undefined ? trtcModelExtra : overrides.modelExtra,
    closeReason: overrides?.closeReason,
  };
}

function makeService(api: ApiServicingStub) {
  return new RealtimeSessionService({
    apiService: api,
    heartbeatIntervalMs: 1,
    sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  });
}

/** 等待若干宏任务，让心跳循环推进。 */
async function flushHeartbeats(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

describe("RealtimeSessionService", () => {
  it("creates a session and parses TRTC connection info", async () => {
    const api = new ApiServicingStub();
    api.postResponses = [sessionPayload()];
    const service = makeService(api);

    const session = await service.createSession(RealtimeModel.x2_0);

    expect(api.requests[0]).toMatchObject({
      method: ApiMethod.post,
      path: "/session",
      body: { model: "x2.0" },
    });
    expect(session.id).toBe("ums-001");
    expect(session.userID).toBe("user-001");
    expect(session.connection).toMatchObject({
      provider: "trtc",
      roomID: "100000001",
      sdkAppID: "1600126360",
      userID: "rtc-user-001",
      userSig: "sig-v1",
      privateMapKey: "pmk-v1",
      botID: "bot001",
    });
  });

  it("parses modelExtra delivered as a JSON string", async () => {
    const api = new ApiServicingStub();
    api.postResponses = [sessionPayload({ modelExtra: JSON.stringify(trtcModelExtra) })];
    const service = makeService(api);

    const session = await service.createSession(RealtimeModel.x2_0);
    expect(session.connection?.sdkAppID).toBe("1600126360");
    expect(session.connection?.userSig).toBe("sig-v1");
  });

  it("rejects session creation when RTC join info is incomplete", async () => {
    const api = new ApiServicingStub();
    api.postResponses = [
      sessionPayload({ modelExtra: { ...trtcModelExtra, user_sig: "" } }),
    ];
    const service = makeService(api);

    await expect(service.createSession(RealtimeModel.x2_0)).rejects.toMatchObject({
      code: XmaxErrorCode.sessionError,
    });
  });

  it("rejects session creation for non-TRTC providers", async () => {
    const api = new ApiServicingStub();
    api.postResponses = [
      sessionPayload({ modelExtra: { room_id: "1", room_token: "t", user_id: "u" } }),
    ];
    const service = makeService(api);

    await expect(service.createSession(RealtimeModel.x2_0)).rejects.toMatchObject({
      code: XmaxErrorCode.sessionError,
    });
  });

  it("reports refreshed credentials through the heartbeat refresh handler", async () => {
    const api = new ApiServicingStub();
    api.putResponses = [
      sessionPayload({ modelExtra: { ...trtcModelExtra, user_sig: "sig-v2" } }),
    ];
    const service = makeService(api);

    const refreshed: RealtimeSession[] = [];
    service.startHeartbeat("ums-001", {
      onFailure: () => {},
      onRefresh: (session) => refreshed.push(session),
    });
    await flushHeartbeats();
    service.stopHeartbeat();

    expect(api.requests.some((r) => r.method === ApiMethod.put && r.path === "/session/ums-001/heartbeat")).toBe(true);
    expect(refreshed.length).toBeGreaterThan(0);
    expect(refreshed[0]?.connection?.userSig).toBe("sig-v2");
  });

  it("reports heartbeat failure when the session is no longer active", async () => {
    const api = new ApiServicingStub();
    api.putResponses = [
      sessionPayload({ status: "CLOSED", closeReason: "Session expired" }),
    ];
    const service = makeService(api);

    const failures: XmaxError[] = [];
    service.startHeartbeat("ums-001", {
      onFailure: (_id, error) => {
        failures.push(error);
      },
    });
    await flushHeartbeats();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      code: XmaxErrorCode.sessionError,
      message: "Session expired",
    });
  });

  it("invalidates late heartbeat results after stopHeartbeat", async () => {
    const api = new ApiServicingStub();
    api.putResponses = [sessionPayload()];
    const service = makeService(api);

    let refreshCount = 0;
    service.startHeartbeat("ums-001", {
      onFailure: () => {},
      onRefresh: () => {
        refreshCount += 1;
      },
    });
    await flushHeartbeats();
    service.stopHeartbeat();
    const countAtStop = refreshCount;
    expect(countAtStop).toBeGreaterThan(0);

    await flushHeartbeats();
    expect(refreshCount).toBe(countAtStop);
  });

  it("closes the session through DELETE", async () => {
    const api = new ApiServicingStub();
    api.deleteResponses = [{}];
    const service = makeService(api);

    await service.closeSession("ums-001");
    expect(api.requests[0]).toMatchObject({
      method: ApiMethod.delete,
      path: "/session/ums-001",
    });
  });
});
