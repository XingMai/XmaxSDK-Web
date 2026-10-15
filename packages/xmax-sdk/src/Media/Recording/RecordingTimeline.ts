/**
 * 原始录制时间线上的区间，单位为秒。
 */
export interface RecordingTimeRange {
  start: number;
  end: number;
}

/**
 * 视频长帧裁剪计划。音视频共用同一映射，避免分别累计时间造成漂移。
 */
export class RecordingTimeline {
  /**
   * 长间隔判定与默认帧时长
   */
  private static readonly minimumGap = 0.12;
  private static readonly gapMultiplier = 3;
  private static readonly fallbackFrameDuration = 1 / 30;

  /**
   * 原始时长、正常帧时长与待删除区间
   */
  readonly frameDuration: number;
  readonly cuts: readonly RecordingTimeRange[];

  /**
   * 从显示时间戳估计正常帧间隔，只裁掉显著超长的等待部分。
   */
  constructor(timestamps: readonly number[], readonly duration: number, audioPackets?: readonly RecordingTimeRange[]) {
    if (!Number.isFinite(duration) || duration <= 0 || timestamps.length === 0 ||
        timestamps.some(value => !Number.isFinite(value) || value < 0 || value > duration)) {
      throw new Error("Invalid recording timeline");
    }

    const sorted = [...timestamps].sort((a, b) => a - b);
    const intervals = sorted.slice(1).map((time, index) => time - sorted[index]!)
      .filter(value => value > 0).sort((a, b) => a - b);
    this.frameDuration = intervals[Math.floor(intervals.length / 2)] ?? RecordingTimeline.fallbackFrameDuration;
    const threshold = Math.max(RecordingTimeline.minimumGap, this.frameDuration * RecordingTimeline.gapMultiplier);

    const cuts = sorted.flatMap((start, index) => {
      const end = sorted[index + 1] ?? duration;
      return end - start > threshold + 1e-6 ? [{ start: start + this.frameDuration, end }] : [];
    });

    // 只删除完全落在等待区间内的音频包；同一裁剪边界同时用于视频，避免重编码延迟。
    this.cuts = audioPackets ? cuts.flatMap(cut => {
      const contained = audioPackets.filter(packet => packet.end > packet.start &&
        packet.start >= cut.start && packet.end <= cut.end);
      if (contained.length === 0) {
        return [];
      }
      return [{
        start: Math.min(...contained.map(packet => packet.start)),
        end: Math.max(...contained.map(packet => packet.end)),
      }];
    }) : cuts;
  }

  /**
   * 将原始时间映射到裁剪后的时间；删除区间内的时刻映射到同一接缝。
   */
  map(time: number): number {
    let removed = 0;
    for (const cut of this.cuts) {
      if (time <= cut.start) {
        break;
      }
      removed += Math.min(time, cut.end) - cut.start;
    }
    return time - removed;
  }

  /**
   * 判断一个音频包是否位于删除区间；区间已对齐包边界，不会切断压缩数据。
   */
  removes(start: number, end: number): boolean {
    return this.cuts.some(cut => start >= cut.start && end <= cut.end);
  }
}
