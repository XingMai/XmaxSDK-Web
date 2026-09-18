export interface RealtimePointInit {
  /** 归一化横坐标。 */
  x: number;

  /** 归一化纵坐标。 */
  y: number;
}

/**
 * 归一化坐标系中的二维点。
 */
export class RealtimePoint {
  // 坐标
  /** 归一化横坐标。 */
  readonly x: number;

  /** 归一化纵坐标。 */
  readonly y: number;

  /**
   * 创建归一化坐标点。
   *
   * @param init.x 归一化横坐标。
   * @param init.y 归一化纵坐标。
   */
  constructor(init: RealtimePointInit) {
    this.x = init.x;
    this.y = init.y;
  }
}
