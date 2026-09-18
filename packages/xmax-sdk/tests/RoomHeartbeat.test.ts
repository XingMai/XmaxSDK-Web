import { describe, expect, it } from "vitest";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import type { RtcManaging } from "../src/Foundation/RTC/RtcManaging";
import { RoomHeartbeat } from "../src/Stream/Room/RoomHeartbeat";

class RtcMessagingStub {
  sentMessages: string[] = [];
  failNextSend = false;

  sendRoomMessage(message: string): void {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new XmaxError(XmaxErrorCode.rtcError, "send failed");
    }
    this.sentMessages.push(message);
  }
}

async function flush(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

describe("RoomHeartbeat", () => {
  it("sends heartbeat room messages periodically", async () => {
    const rtc = new RtcMessagingStub();
    const heartbeat = new RoomHeartbeat({
      rtcManager: rtc as unknown as RtcManaging,
      intervalMs: 1,
      sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    });

    heartbeat.start("user-001");
    await flush();
    heartbeat.stop();

    expect(rtc.sentMessages.length).toBeGreaterThan(0);
    const parsed = JSON.parse(rtc.sentMessages[0]!);
    expect(parsed.event).toBe("heartbeat");
    expect(parsed.user_id).toBe("user-001");
  });

  it("stops sending after stop", async () => {
    const rtc = new RtcMessagingStub();
    const heartbeat = new RoomHeartbeat({
      rtcManager: rtc as unknown as RtcManaging,
      intervalMs: 1,
      sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    });

    heartbeat.start("user-001");
    await flush();
    heartbeat.stop();
    const countAtStop = rtc.sentMessages.length;
    expect(countAtStop).toBeGreaterThan(0);

    await flush();
    expect(rtc.sentMessages.length).toBe(countAtStop);
  });

  it("keeps the cycle running when a send fails", async () => {
    const rtc = new RtcMessagingStub();
    const heartbeat = new RoomHeartbeat({
      rtcManager: rtc as unknown as RtcManaging,
      intervalMs: 1,
      sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    });

    rtc.failNextSend = true;
    heartbeat.start("user-001");
    await flush();
    heartbeat.stop();

    expect(rtc.sentMessages.length).toBeGreaterThan(0);
  });
});
