import {
  BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink,
  EncodedVideoPacketSource, Input, MP4, WEBM, Mp4OutputFormat, Output, WebMOutputFormat,
  type EncodedPacket, type InputTrack,
} from "mediabunny";
import { RecordingTimeline } from "./RecordingTimeline";

/**
 * 录制完成后裁掉长帧等待；音视频共用按音频包边界对齐的时间映射，不重新编码。
 */
export class RecordingProcessor {
  /**
   * 后处理资源上限，与实时连接的清理超时分离
   */
  private static readonly timeoutMs = 10_000;
  private static readonly maximumBytes = 64 * 1024 * 1024;
  private static readonly maximumPackets = 10_000;

  /**
   * 裁剪成功返回新文件，无需裁剪时返回原文件；失败交由调用方保留原始录像。
   */
  async process(blob: Blob): Promise<Blob> {
    if (blob.size > RecordingProcessor.maximumBytes) {
      throw new Error("Recording is too large to process");
    }

    const input = new Input({ source: new BlobSource(blob), formats: [MP4, WEBM] });
    const controller = new AbortController();
    let output: Output | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Recording processing timed out"));
      }, RecordingProcessor.timeoutMs);
    });

    try {
      return await Promise.race([
        this.rewrite(input, blob, controller.signal, value => { output = value; }),
        timeout,
      ]);
    } finally {
      controller.abort();
      clearTimeout(timer);
      input.dispose();
      if (output && output.state !== "finalized" && output.state !== "canceled") {
        void output.cancel().catch(() => {});
      }
    }
  }

  /**
   * 读取有限数量的编码包，维持原始解码顺序。
   */
  private async readPackets(track: InputTrack, signal: AbortSignal): Promise<EncodedPacket[]> {
    const packets: EncodedPacket[] = [];
    for await (const packet of new EncodedPacketSink(track).packets()) {
      signal.throwIfAborted();
      packets.push(packet);
      if (packets.length > RecordingProcessor.maximumPackets) {
        throw new Error("Recording has too many media packets");
      }
    }
    return packets;
  }

  /**
   * 保留所有视频帧，删除等待区间内的完整音频包，并重新封装两条时间线。
   */
  private async rewrite(
    input: Input,
    original: Blob,
    signal: AbortSignal,
    registerOutput: (output: Output) => void,
  ): Promise<Blob> {
    const video = await input.getPrimaryVideoTrack();
    if (!video) {
      throw new Error("Recording has no video track");
    }
    const videoPackets = await this.readPackets(video, signal);
    const audio = await input.getPrimaryAudioTrack();
    const audioPackets = audio ? await this.readPackets(audio, signal) : [];
    const duration = await input.computeDuration();
    const audioRanges = audioPackets.map((packet, index) => ({
      start: packet.timestamp,
      end: packet.duration > 0 ? packet.timestamp + packet.duration : audioPackets[index + 1]?.timestamp ?? duration,
    }));
    const timeline = new RecordingTimeline(videoPackets.map(packet => packet.timestamp), duration, audio ? audioRanges : undefined);
    if (timeline.cuts.length === 0) {
      return original;
    }

    const videoCodec = await video.getCodec();
    const videoConfig = await video.getDecoderConfig();
    const audioCodec = await audio?.getCodec();
    const audioConfig = await audio?.getDecoderConfig();
    if (!videoCodec || !videoConfig || (audio && (!audioCodec || !audioConfig))) {
      throw new Error("Unsupported recording codec");
    }
    const isWebM = (await input.getFormat()).name === WEBM.name;
    const rotation = await video.getRotation();
    const flip = await video.getFlip();
    signal.throwIfAborted();

    const output = new Output({
      format: isWebM ? new WebMOutputFormat() : new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    registerOutput(output);
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    output.addVideoTrack(videoSource, { rotation, flip });
    const audioSource = audioCodec ? new EncodedAudioPacketSource(audioCodec) : undefined;
    if (audioSource) {
      output.addAudioTrack(audioSource);
    }
    await output.start();

    // 不指定固定帧率，避免容器把原本不同的显示时间戳量化到同一帧。
    for (const packet of videoPackets) {
      signal.throwIfAborted();
      const timestamp = timeline.map(packet.timestamp);
      const duration = timeline.map(packet.timestamp + packet.duration) - timestamp;
      await videoSource.add(packet.clone({ timestamp, duration }), { decoderConfig: videoConfig });
    }
    videoSource.close();

    if (audioSource && audioConfig) {
      for (const [index, packet] of audioPackets.entries()) {
        signal.throwIfAborted();
        const range = audioRanges[index]!;
        if (timeline.removes(range.start, range.end)) {
          continue;
        }
        await audioSource.add(packet.clone({ timestamp: timeline.map(packet.timestamp) }), { decoderConfig: audioConfig });
      }
      audioSource.close();
    }
    signal.throwIfAborted();
    await output.finalize();
    if (!output.target.buffer || output.target.buffer.byteLength > RecordingProcessor.maximumBytes) {
      throw new Error("Processed recording exceeds the memory limit");
    }
    return new Blob([output.target.buffer], { type: output.format.mimeType });
  }
}
