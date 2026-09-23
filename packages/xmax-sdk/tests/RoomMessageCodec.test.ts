import { describe, expect, it } from "vitest";
import { RoomMessageCodec } from "../src/Stream/Room/RoomMessageCodec";

describe("RoomMessageCodec", () => {
  it("passes through messages within the byte threshold", () => {
    const codec = new RoomMessageCodec();
    const message = JSON.stringify({ event: "heartbeat", user_id: "user-001" });
    expect(codec.encodeOutgoing(message)).toEqual([message]);
  });

  it("chunks oversized messages and reassembles them out of order", () => {
    const codec = new RoomMessageCodec();
    // 含多字节字符的长消息，验证切分不破坏 UTF-8 字符。
    const message = JSON.stringify({
      event: "tracks",
      uid: "task-001",
      user_id: "user-001",
      note: "中文与emoji🎬".repeat(80),
    });
    expect(new TextEncoder().encode(message).byteLength).toBeGreaterThan(800);

    const chunks = codec.encodeOutgoing(message);
    expect(chunks.length).toBeGreaterThan(1);

    const parsed = chunks.map((chunk) => JSON.parse(chunk));
    const eventId = parsed[0].eventId;
    for (const [index, chunk] of parsed.entries()) {
      expect(chunk.event).toBe("__trtc_chunk__");
      expect(chunk.eventId).toBe(eventId);
      expect(chunk.index).toBe(index);
      expect(chunk.count).toBe(chunks.length);
      expect(new TextEncoder().encode(chunks[index]).byteLength).toBeLessThanOrEqual(800);
    }

    // 乱序组包：先尾后头。
    const receiver = new RoomMessageCodec();
    const shuffled = [...chunks].reverse();
    for (const chunk of shuffled.slice(0, -1)) {
      expect(receiver.processIncoming("sender-001", chunk)).toBeUndefined();
    }
    expect(receiver.processIncoming("sender-001", shuffled[shuffled.length - 1]!)).toEqual(
      JSON.parse(message),
    );
  });

  it("treats non-chunk JSON as plain business messages", () => {
    const codec = new RoomMessageCodec();
    const plain = '{"event":"tracks","user_id":"user-001"}';
    expect(codec.processIncoming("sender-001", plain)).toEqual(JSON.parse(plain));
  });

  it("treats chunk-like messages with incomplete fields as plain messages", () => {
    const codec = new RoomMessageCodec();
    const broken = '{"event":"__trtc_chunk__","eventId":"x"}';
    expect(codec.processIncoming("sender-001", broken)).toEqual(JSON.parse(broken));
  });

  it("discards reassembled messages that are not valid JSON", () => {
    const codec = new RoomMessageCodec();
    const chunks = [
      { event: "__trtc_chunk__", eventId: "evt-1", index: 0, count: 2, data: "not{" },
      { event: "__trtc_chunk__", eventId: "evt-1", index: 1, count: 2, data: "json" },
    ];
    expect(codec.processIncoming("s", JSON.stringify(chunks[0]))).toBeUndefined();
    expect(codec.processIncoming("s", JSON.stringify(chunks[1]))).toBeUndefined();
  });

  it("keeps chunk groups isolated per sender", () => {
    const codec = new RoomMessageCodec();
    const chunkOf = (senderPart: string, index: number) =>
      JSON.stringify({
        event: "__trtc_chunk__",
        eventId: "evt-1",
        index,
        count: 2,
        data: senderPart,
      });

    expect(codec.processIncoming("a", chunkOf('{"v":', 0))).toBeUndefined();
    expect(codec.processIncoming("b", chunkOf("1}", 1))).toBeUndefined();
    // b 的组包仍缺 index=0；a 收齐后返回完整消息。
    expect(codec.processIncoming("a", chunkOf("1}", 1))).toEqual({ v: 1 });
    expect(codec.processIncoming("b", chunkOf('{"v":', 0))).toEqual({ v: 1 });
  });
});
