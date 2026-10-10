import { describe, expect, it, vi } from "vitest";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { ApiMethod, type ApiServicing } from "../src/Service/Network/ApiServicing";
import type { RealtimeSession } from "../src/Service/Realtime/RealtimeSession";
import { RealtimeSessionService } from "../src/Service/Realtime/RealtimeSessionService";

const trtcModelExtra = {
  room_id: "100000001",
  bot_name: "bot001",
  user_id: "user-001",
  provider: RtcProvider.trtc,
  rtc_app_id: "1600126360",
  rtc_user_id: "rtc-user-001",
  rtc_bot_id: "bot001",
  user_sig: "sig-v1",
  private_map_key_with_string_room_id: "pmk-v1",
};

const agoraModelExtra = {
  provider: RtcProvider.agora, room_id: "000123", rtc_app_id: "agora-app", rtc_user_id: "rtc-user",
  rtc_bot_id: "bot-agora", room_token: "token-v1", rtc_area: "GLOBAL",
};

class ApiServicingStub implements ApiServicing {
  requests: { method: ApiMethod; path: string; body?: unknown; keepalive?: boolean }[] = [];
  postResponses: Array<unknown | Error> = [];
  putResponses: Array<unknown | Error> = [];
  deleteResponses: Array<unknown | Error> = [];

  request<T>(method: ApiMethod, path: string, body?: unknown, options?: { keepalive?: boolean }): Promise<T> {
    this.requests.push({ method, path, body, keepalive: options?.keepalive });
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

  delete<T>(path: string, options?: { keepalive?: boolean }): Promise<T> {
    return this.request<T>(ApiMethod.delete, path, undefined, options);
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

function makeService(api: ApiServicingStub, provider = RtcProvider.trtc) {
  return new RealtimeSessionService({
    apiService: api,
    provider,
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
  it.each([
    [RealtimeModel.x2_0, "x2.0"],
    [RealtimeModel.x2_0_trtc, "x2.0-trtc"],
    ["future-model", "future-model"],
    [" Future/Model:v2 ", " Future/Model:v2 "],
  ] as const)("creates a %s session and parses TRTC connection info", async (model, modelID) => {
    const api = new ApiServicingStub();
    api.postResponses = [sessionPayload()];
    const service = makeService(api);

    const session = await service.createSession(model);

    expect(api.requests[0]).toMatchObject({
      method: ApiMethod.post,
      path: "/session",
      body: { model: modelID },
    });
    expect(session.id).toBe("ums-001");
    expect(session.userID).toBe("user-001");
    expect(session.connection).toMatchObject({
      provider: RtcProvider.trtc,
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

    const session = await service.createSession(RealtimeModel.x2_0_trtc);
    expect(session.connection).toMatchObject({ provider: RtcProvider.trtc, sdkAppID: "1600126360", userSig: "sig-v1" });
  });

  it("rejects session creation when RTC join info is incomplete", async () => {
    const api = new ApiServicingStub();
    api.postResponses = [
      sessionPayload({ modelExtra: { ...trtcModelExtra, user_sig: "" } }),
    ];
    const service = makeService(api);

    await expect(service.createSession(RealtimeModel.x2_0_trtc)).rejects.toMatchObject({
      code: XmaxErrorCode.sessionError,
    });
  });

  it("rejects incomplete credentials for the configured default TRTC provider", async () => {
    const api = new ApiServicingStub();
    api.postResponses = [
      sessionPayload({ modelExtra: { room_id: "1", room_token: "t", user_id: "u" } }),
    ];
    const service = makeService(api);

    await expect(service.createSession(RealtimeModel.x2_0_trtc)).rejects.toMatchObject({
      code: XmaxErrorCode.sessionError,
    });
  });

  it.each([false, true])("parses Agora credentials with JSON encoding %s and sends the chosen model", async (encoded) => {
    const api = new ApiServicingStub();
    api.postResponses = [sessionPayload({ modelExtra: encoded ? JSON.stringify(agoraModelExtra) : agoraModelExtra })];
    const session = await makeService(api, RtcProvider.agora).createSession(RealtimeModel.x2_1_preview);
    expect(api.requests[0]?.body).toEqual({ model: "x2.1-preview" });
    expect(session.userID).toBe("user-001");
    expect(session.connection).toEqual({ provider: RtcProvider.agora, roomID: "000123", appID: "agora-app",
      userID: "rtc-user", botID: "bot-agora", roomToken: "token-v1" });
  });

  it.each(["room_token", "rtc_user_id", "rtc_app_id", "room_id"])("rejects missing Agora %s and closes the allocated session", async (field) => {
    const api = new ApiServicingStub();
    api.postResponses = [sessionPayload({ modelExtra: { ...agoraModelExtra, [field]: "" } })];
    api.deleteResponses = [{}];
    await expect(makeService(api, RtcProvider.agora).createSession(RealtimeModel.x2_1_preview)).rejects.toMatchObject({ code: XmaxErrorCode.sessionError });
    expect(api.requests.at(-1)).toMatchObject({ method: ApiMethod.delete, path: "/session/ums-001", keepalive: true });
  });

  it("merges partial heartbeat credentials and deduplicates concurrent refresh requests", async () => {
    const api = new ApiServicingStub();
    api.postResponses = [sessionPayload({ modelExtra: agoraModelExtra })];
    api.putResponses = [sessionPayload({ modelExtra: { room_token: "token-v2" } }), sessionPayload({})];
    const service = makeService(api, RtcProvider.agora);
    await service.createSession(RealtimeModel.x2_1_preview);
    const [first, second] = await Promise.all([service.heartbeatSession("ums-001"), service.heartbeatSession("ums-001")]);
    expect(first).toBe(second);
    expect(first.connection).toMatchObject({ provider: RtcProvider.agora, roomID: "000123", userID: "rtc-user", roomToken: "token-v2" });
    expect(api.requests.filter(r => r.method === ApiMethod.put)).toHaveLength(1);
    expect((await service.heartbeatSession("ums-001")).connection).toEqual(first.connection);
  });

  it("rejects malformed or rebound heartbeat credentials without exposing the token", async () => {
    const api = new ApiServicingStub();
    api.postResponses = [sessionPayload({ modelExtra: agoraModelExtra })];
    api.putResponses = [sessionPayload({ modelExtra: "not json" }), { ...sessionPayload({}), sessionUid: "other" }];
    const service = makeService(api, RtcProvider.agora);
    await service.createSession(RealtimeModel.x2_1_preview);
    await expect(service.heartbeatSession("ums-001")).rejects.toThrow("Invalid heartbeat RTC credentials");
    await expect(service.heartbeatSession("ums-001")).rejects.toThrow("identity changed");
  });

  it("waits for asynchronous credential application and reports renew failure", async () => {
    const api = new ApiServicingStub();
    api.putResponses = [sessionPayload({ modelExtra: agoraModelExtra })];
    const service = makeService(api, RtcProvider.agora);
    const onFailure = vi.fn();
    service.startHeartbeat("ums-001", { onFailure, onRefresh: async () => { throw new Error("renew failed"); } });
    await flushHeartbeats();
    service.stopHeartbeat();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith("ums-001", expect.objectContaining({ message: "renew failed" }));
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
      onRefresh: (session) => { refreshed.push(session); },
    });
    await flushHeartbeats();
    service.stopHeartbeat();

    expect(api.requests.some((r) => r.method === ApiMethod.put && r.path === "/session/ums-001/heartbeat")).toBe(true);
    expect(refreshed.length).toBeGreaterThan(0);
    expect(refreshed[0]?.connection).toMatchObject({ provider: RtcProvider.trtc, userSig: "sig-v2" });
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

  it("closes the session through DELETE with keepalive", async () => {
    const api = new ApiServicingStub();
    api.deleteResponses = [{}];
    const service = makeService(api);

    await service.closeSession("ums-001");
    expect(api.requests[0]).toMatchObject({
      method: ApiMethod.delete,
      path: "/session/ums-001",
      keepalive: true,
    });
  });
});

describe("caller-selected RTC provider", () => {
  const vertc = { room_id: "000123", rtc_app_id: "69a177e226e9b90176a86b96", room_token: "token-v1", user_id: "ve-user", bot_name: "bot_001" };

  it.each([undefined, "wrong-provider", "trtc", "agora", "vertc"])("ignores backend provider %s for all configured adapters", async (backendProvider) => {
    for (const [provider, credentials] of [[RtcProvider.trtc, trtcModelExtra], [RtcProvider.agora, agoraModelExtra], [RtcProvider.vertc, vertc]] as const) {
      const api = new ApiServicingStub();
      api.postResponses = [sessionPayload({ modelExtra: { ...credentials, provider: backendProvider } })];
      const session = await makeService(api, provider).createSession(RealtimeModel.x2_1_preview);
      expect(session.connection?.provider).toBe(provider);
    }
  });

  it.each([false, true])("parses VeRTC credentials with JSON encoding %s and uses the preview model", async (encoded) => {
    const api = new ApiServicingStub();
    api.postResponses = [sessionPayload({ modelExtra: encoded ? JSON.stringify(vertc) : vertc })];
    const session = await makeService(api, RtcProvider.vertc).createSession(RealtimeModel.x2_1_preview);
    expect(api.requests[0]?.body).toEqual({ model: "x2.1-preview" });
    expect(session.connection).toEqual({ provider: RtcProvider.vertc, appID: vertc.rtc_app_id, roomID: "000123", userID: "ve-user", botID: "bot_001", roomToken: "token-v1" });
  });

  it("preserves the userUid fallback through partial heartbeat responses", async () => {
    const api = new ApiServicingStub();
    api.postResponses = [sessionPayload({ modelExtra: { ...vertc, user_id: undefined } })];
    api.putResponses = [{ sessionUid: "ums-001", status: "ACTIVE", modelExtra: { room_token: "token-v2", provider: RtcProvider.trtc } }];
    const service = makeService(api, RtcProvider.vertc);
    expect((await service.createSession(RealtimeModel.x2_1_preview)).connection?.userID).toBe("user-001");
    expect((await service.heartbeatSession("ums-001")).connection).toMatchObject({ provider: RtcProvider.vertc, roomToken: "token-v2", userID: "user-001", botID: "bot_001" });
  });

  it.each(["room_token", "rtc_app_id", "room_id"])("closes allocated VeRTC sessions missing %s", async (field) => {
    const api = new ApiServicingStub();
    api.postResponses = [sessionPayload({ modelExtra: { ...vertc, [field]: "" } })];
    api.deleteResponses = [{}];
    await expect(makeService(api, RtcProvider.vertc).createSession(RealtimeModel.x2_1_preview)).rejects.toMatchObject({ code: XmaxErrorCode.sessionError });
    expect(api.requests.at(-1)).toMatchObject({ method: ApiMethod.delete, path: "/session/ums-001" });
  });
});
