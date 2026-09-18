import { describe, expect, it } from "vitest";
import {
  RealtimeCoordinator,
  RealtimeOperationKind,
  RealtimeTerminationScope,
  type RealtimeCleanupResult,
} from "../src/Core/Realtime/RealtimeCoordinator";
import { RealtimeErrorHandler } from "../src/Core/Realtime/RealtimeErrorHandler";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import {
  RealtimeConnectionState,
  RealtimeState,
  type RealtimeStateListener,
} from "../src/Service/Realtime/RealtimeState";

function makeCoordinator(options?: {
  cleanup?: (
    scope: RealtimeTerminationScope,
  ) => Promise<RealtimeCleanupResult>;
  states?: RealtimeState[];
}) {
  const states = options?.states ?? [];
  const coordinator = new RealtimeCoordinator({
    errorHandler: new RealtimeErrorHandler(),
    cleanup:
      options?.cleanup ??
      (async () => ({ hasLocalMedia: false })),
  });
  const listener: RealtimeStateListener = (state) => {
    states.push(state);
  };
  return { coordinator, states, listener };
}

describe("RealtimeCoordinator", () => {
  it("starts in idle state", () => {
    const { coordinator } = makeCoordinator();
    expect(coordinator.currentState.connectionState).toBe(
      RealtimeConnectionState.idle,
    );
  });

  it("emits the current state immediately when a listener is set", async () => {
    const { coordinator, states, listener } = makeCoordinator();
    await coordinator.setStateListener(listener);
    expect(states).toHaveLength(1);
    expect(states[0]?.connectionState).toBe(RealtimeConnectionState.idle);
  });

  it("runs an operation and returns its value", async () => {
    const { coordinator } = makeCoordinator();
    const value = await coordinator.run(
      RealtimeOperationKind.media,
      undefined,
      async (token) => {
        token.ensureCurrent();
        return 42;
      },
    );
    expect(value).toBe(42);
  });

  it("rejects a second concurrent operation", async () => {
    const { coordinator } = makeCoordinator();
    let release!: () => void;
    const blocking = coordinator.run(
      RealtimeOperationKind.media,
      undefined,
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(1);
        }),
    );

    await expect(
      coordinator.run(RealtimeOperationKind.media, undefined, async () => 2),
    ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });

    release();
    await expect(blocking).resolves.toBe(1);
  });

  it("moves from preparing to ready when the local preview becomes ready", async () => {
    const { coordinator, states, listener } = makeCoordinator();
    await coordinator.setStateListener(listener);

    await coordinator.run(RealtimeOperationKind.media, undefined, async (token) => {
      await coordinator.commit(
        new RealtimeState({ connectionState: RealtimeConnectionState.preparing }),
        token,
      );
      await coordinator.localPreviewDidBecomeReady(() => true);
    });

    expect(states.map((s) => s.connectionState)).toEqual([
      RealtimeConnectionState.idle,
      RealtimeConnectionState.preparing,
      RealtimeConnectionState.ready,
    ]);
  });

  it("ignores a stale preview-ready notification", async () => {
    const { coordinator } = makeCoordinator();
    await coordinator.run(RealtimeOperationKind.media, undefined, async (token) => {
      await coordinator.commit(
        new RealtimeState({ connectionState: RealtimeConnectionState.preparing }),
        token,
      );
      await coordinator.localPreviewDidBecomeReady(() => false);
    });
    expect(coordinator.currentState.connectionState).toBe(
      RealtimeConnectionState.preparing,
    );
  });

  it("terminate(all) runs cleanup and finishes idle with the given reason", async () => {
    const cleanupScopes: RealtimeTerminationScope[] = [];
    const { coordinator, states, listener } = makeCoordinator({
      cleanup: async (scope) => {
        cleanupScopes.push(scope);
        return { hasLocalMedia: false };
      },
    });
    await coordinator.setStateListener(listener);

    await coordinator.terminate(RealtimeTerminationScope.all);

    expect(cleanupScopes).toEqual([RealtimeTerminationScope.all]);
    const last = states[states.length - 1];
    expect(last?.connectionState).toBe(RealtimeConnectionState.idle);
    expect(last?.reason?.kind).toBe("normal");
  });

  it("failed operation with failure scope triggers termination with failure reason", async () => {
    const failure = new XmaxError(XmaxErrorCode.mediaError, "capture failed");
    const { coordinator, states, listener } = makeCoordinator();
    await coordinator.setStateListener(listener);

    await expect(
      coordinator.run(
        RealtimeOperationKind.media,
        RealtimeTerminationScope.all,
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);

    const last = states[states.length - 1];
    expect(last?.connectionState).toBe(RealtimeConnectionState.idle);
    expect(last?.reason?.kind).toBe("failure");
  });

  it("media failure without failure scope restores idle from preparing", async () => {
    const { coordinator } = makeCoordinator();
    await expect(
      coordinator.run(RealtimeOperationKind.media, undefined, async (token) => {
        await coordinator.commit(
          new RealtimeState({
            connectionState: RealtimeConnectionState.preparing,
          }),
          token,
        );
        throw new XmaxError(XmaxErrorCode.cameraPermissionDenied, "denied");
      }),
    ).rejects.toMatchObject({ code: XmaxErrorCode.cameraPermissionDenied });
    expect(coordinator.currentState.connectionState).toBe(
      RealtimeConnectionState.idle,
    );
  });

  it("disconnect is a no-op while idle/preparing/ready", async () => {
    const cleanupCalls: RealtimeTerminationScope[] = [];
    const { coordinator, states, listener } = makeCoordinator({
      cleanup: async (scope) => {
        cleanupCalls.push(scope);
        return { hasLocalMedia: true };
      },
    });
    await coordinator.setStateListener(listener);
    await coordinator.disconnect();
    expect(cleanupCalls).toHaveLength(0);
    expect(states).toHaveLength(1);
  });
});
