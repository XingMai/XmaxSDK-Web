import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";

/** 分片消息的固定事件名。 */
const CHUNK_EVENT = "__trtc_chunk__";

/** 未完成的组包记录。 */
interface ChunkRecord {
  count: number;
  parts: Map<number, string>;
}

/**
 * TRTC 自定义消息拆包协议编解码器。
 *
 * 出站：消息 UTF-8 字节长度超过 800 时按分片 JSON 拆包；
 * 入站：识别分片消息并按 `(发送方, eventId)` 乱序组包，
 * 未收齐时返回 `undefined`，收齐并校验 JSON 后返回完整消息。
 */
export class RoomMessageCodec {
  // 协议常量
  /** 触发拆包的消息字节阈值。 */
  static readonly chunkThresholdBytes = 800;

  /** 单个分片正文的字节预算，保证分片 JSON 自身不超过阈值。 */
  static readonly chunkDataBudgetBytes = 600;

  /** 未完成组包记录的缓存上限（LRU）。 */
  static readonly cacheLimit = 1000;

  // 接收缓存
  private readonly records = new Map<string, ChunkRecord>();

  /**
   * 编码出站消息。
   *
   * @returns 不超过阈值时返回仅含原消息的单元素数组；
   * 否则返回按 `__trtc_chunk__` 协议包装的分片 JSON 数组。
   */
  encodeOutgoing(message: string): string[] {
    if (RoomMessageCodec.byteLength(message) <= RoomMessageCodec.chunkThresholdBytes) {
      return [message];
    }

    const eventId = RoomMessageCodec.makeEventId();
    const slices = RoomMessageCodec.sliceByByteBudget(
      message,
      RoomMessageCodec.chunkDataBudgetBytes,
    );
    const count = slices.length;
    XmaxLogger.room.debug(
      () =>
        `房间消息拆包 (Chunking Room Message)\n` +
        `└─ eventId: ${eventId} · count: ${count} · bytes: ${RoomMessageCodec.byteLength(message)}`,
    );
    return slices.map((data, index) =>
      JSON.stringify({
        event: CHUNK_EVENT,
        eventId,
        index,
        count,
        data,
      }),
    );
  }

  /**
   * 处理入站消息。
   *
   * @returns 普通业务消息原样返回；分片未收齐或组包结果不是合法
   * JSON 时返回 `undefined`；分片收齐后返回完整消息并从缓存移除。
   */
  processIncoming(senderUserID: string, message: string): string | undefined {
    const chunk = RoomMessageCodec.parseChunk(message);
    if (!chunk) {
      return message;
    }

    const key = `${senderUserID}:${chunk.eventId}`;
    let record = this.records.get(key);
    if (!record) {
      record = { count: chunk.count, parts: new Map() };
      this.records.set(key, record);
      this.evictOverflow();
    }
    record.parts.set(chunk.index, chunk.data);

    if (record.parts.size < record.count) {
      return undefined;
    }

    this.records.delete(key);
    const parts: string[] = [];
    for (let index = 0; index < record.count; index += 1) {
      const part = record.parts.get(index);
      if (part === undefined) {
        return undefined;
      }
      parts.push(part);
    }
    const joined = parts.join("");
    try {
      JSON.parse(joined);
    } catch {
      XmaxLogger.room.warning(
        () => `房间消息组包后不是合法 JSON (Reassembled Message Is Not Valid JSON)\n└─ eventId: ${chunk.eventId}`,
      );
      return undefined;
    }
    return joined;
  }

  /** 清空未完成的组包缓存。 */
  reset(): void {
    this.records.clear();
  }

  /** 识别分片消息；字段不完整时按普通业务消息处理。 */
  private static parseChunk(
    message: string,
  ): { eventId: string; index: number; count: number; data: string } | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.event !== CHUNK_EVENT ||
      typeof record.eventId !== "string" ||
      !Number.isInteger(record.index) ||
      !Number.isInteger(record.count) ||
      typeof record.data !== "string"
    ) {
      return undefined;
    }
    const index = record.index as number;
    const count = record.count as number;
    if (count < 1 || index < 0 || index >= count) {
      return undefined;
    }
    return { eventId: record.eventId, index, count, data: record.data };
  }

  /** 淘汰最旧的未完成记录，保持缓存不超过上限。 */
  private evictOverflow(): void {
    while (this.records.size > RoomMessageCodec.cacheLimit) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.records.delete(oldest);
    }
  }

  /** 按 UTF-8 字节预算切分字符串，不拆分多字节字符。 */
  private static sliceByByteBudget(message: string, budget: number): string[] {
    const slices: string[] = [];
    let current = "";
    let currentBytes = 0;
    for (const char of message) {
      const bytes = RoomMessageCodec.byteLength(char);
      if (currentBytes + bytes > budget && current.length > 0) {
        slices.push(current);
        current = "";
        currentBytes = 0;
      }
      current += char;
      currentBytes += bytes;
    }
    if (current.length > 0) {
      slices.push(current);
    }
    return slices;
  }

  /** 计算字符串的 UTF-8 字节长度。 */
  private static byteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
  }

  /** 生成拆包事件标识（32 位十六进制）。 */
  private static makeEventId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, "");
    }
    return Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
  }
}
