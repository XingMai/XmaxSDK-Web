import { describe, expect, it, vi } from "vitest";
import {
  BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink,
  EncodedVideoPacketSource, Input, Output, WEBM, WebMOutputFormat,
} from "mediabunny";
import { RecordingProcessor } from "../src/Media/Recording/RecordingProcessor";

/**
 * 构造容器测试数据，不使用摄像头、麦克风或浏览器编解码器。
 * 视频负载仅用于验证原样重封装，不用于测试图像解码。
 */
async function fixture(timestamps: number[], withAudio = true): Promise<Blob> {
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const video = new EncodedVideoPacketSource("vp8");
  const audio = new EncodedAudioPacketSource("opus");
  output.addVideoTrack(video);
  if (withAudio) {
    output.addAudioTrack(audio);
  }
  await output.start();
  for (const [index, timestamp] of timestamps.entries()) {
    await video.add(new EncodedPacket(new Uint8Array([0x10, 0, 0, 0x9d, 1, 0x2a, 16, 0, 16, 0, index]), "key", timestamp, 0.04), {
      decoderConfig: { codec: "vp8", codedWidth: 16, codedHeight: 16 },
    });
  }
  video.close();
  if (withAudio) {
    const duration = timestamps[timestamps.length - 1]! + 0.04;
    for (let index = 0; index * 0.02 < duration - 1e-6; index++) {
      await audio.add(new EncodedPacket(new Uint8Array([0xf8, 0xff, 0xfe]), "key", index * 0.02, 0.02), {
        decoderConfig: { codec: "opus", sampleRate: 48000, numberOfChannels: 1 },
      });
    }
    audio.close();
  }
  await output.finalize();
  return new Blob([output.target.buffer!], { type: "video/webm" });
}

async function inspect(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: [WEBM] });
  try {
    const video = (await input.getPrimaryVideoTrack())!;
    const audio = await input.getPrimaryAudioTrack();
    const videoPackets: EncodedPacket[] = [];
    const audioPackets: EncodedPacket[] = [];
    for await (const packet of new EncodedPacketSink(video).packets()) {
      videoPackets.push(packet);
    }
    if (audio) {
      for await (const packet of new EncodedPacketSink(audio).packets()) {
        audioPackets.push(packet);
      }
    }
    return { videoPackets, audioPackets, duration: await input.computeDuration() };
  } finally {
    input.dispose();
  }
}

describe("RecordingProcessor", () => {
  it("returns the same blob when no long gaps exist", async () => {
    const blob = await fixture([0, 0.04, 0.08, 0.12, 0.16]);
    expect(await new RecordingProcessor().process(blob)).toBe(blob);
  });

  it("remuxes all video frames unchanged and cuts audio with the same timestamps", async () => {
    const blob = await fixture([0, 0.04, 0.08, 1.3, 1.34, 1.38]);
    const before = await inspect(blob);
    const result = await new RecordingProcessor().process(blob);
    const after = await inspect(result);
    expect(result.type).toBe("video/webm");
    expect(after.videoPackets.map(packet => [...packet.data])).toEqual(before.videoPackets.map(packet => [...packet.data]));
    expect(after.duration).toBeLessThan(0.3);
    expect(after.audioPackets.length).toBeLessThan(before.audioPackets.length);
    const videoShift = before.videoPackets[3]!.timestamp - after.videoPackets[3]!.timestamp;
    const retained = before.audioPackets.filter(packet => packet.timestamp >= 1.3);
    const last = after.audioPackets.slice(-retained.length);
    expect(last.length).toBe(retained.length);
    for (const [index, packet] of retained.entries()) {
      expect(last[index]!.timestamp).toBeCloseTo(packet.timestamp - videoShift, 3);
      expect([...last[index]!.data]).toEqual([...packet.data]);
    }
  });

  it("also processes video-only recordings", async () => {
    const blob = await fixture([0, 0.04, 0.08, 1, 1.04, 1.08], false);
    const after = await inspect(await new RecordingProcessor().process(blob));
    expect(after.videoPackets).toHaveLength(6);
    expect(after.audioPackets).toHaveLength(0);
    expect(after.duration).toBeLessThan(0.3);
  });

  it("rejects malformed files and oversized buffers", async () => {
    await expect(new RecordingProcessor().process(new Blob(["not a video"]))).rejects.toThrow();
    await expect(new RecordingProcessor().process({ size: 65 * 1024 * 1024 } as Blob)).rejects.toThrow("too large");
  });

  it("bounds stalled processing and disposes the input", async () => {
    vi.useFakeTimers();
    const read = vi.spyOn(Input.prototype, "getPrimaryVideoTrack").mockImplementationOnce(() => new Promise(() => {}));
    const dispose = vi.spyOn(Input.prototype, "dispose");
    try {
      const result = new RecordingProcessor().process(new Blob(["pending"]));
      const assertion = expect(result).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(dispose).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      read.mockRestore();
      dispose.mockRestore();
      vi.useRealTimers();
    }
  });

  it("cancels an unfinished muxer if rewriting fails", async () => {
    const blob = await fixture([0, 0.04, 0.08, 1, 1.04, 1.08]);
    const add = vi.spyOn(EncodedVideoPacketSource.prototype, "add").mockRejectedValueOnce(new Error("mux error"));
    const cancel = vi.spyOn(Output.prototype, "cancel");
    try {
      await expect(new RecordingProcessor().process(blob)).rejects.toThrow("mux error");
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      add.mockRestore();
      cancel.mockRestore();
    }
  });
});
