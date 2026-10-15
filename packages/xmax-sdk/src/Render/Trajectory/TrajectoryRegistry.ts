import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import type { TrajectoryBinding } from "./TrajectoryBinding";

/**
 * 按 Track 对象身份查找交互能力；不以可能重复的轨道字符串 ID 为索引。
 */
export class TrajectoryRegistry {
  private static readonly bindings = new WeakMap<RealtimeVideoTrack, TrajectoryBinding>();

  /**
   * 替换绑定前先使旧绑定失效。
   */
  static register(track: RealtimeVideoTrack, binding: TrajectoryBinding): void {
    this.unregister(track);
    this.bindings.set(track, binding);
  }

  /**
   * 查询交互能力，本地轨道不注册该能力。
   */
  static binding(track: RealtimeVideoTrack): TrajectoryBinding | undefined {
    return this.bindings.get(track);
  }

  /**
   * 主动清理视图资源，不能仅依赖 WeakMap 垃圾回收。
   */
  static unregister(track: RealtimeVideoTrack): void {
    this.bindings.get(track)?.invalidate();
    this.bindings.delete(track);
  }
}
