export interface RealtimePointInit {
  /**
   * 模型输入像素横坐标。
   */
  x: number;

  /**
   * 模型输入像素纵坐标。
   */
  y: number;
}

/**
 * 模型输入像素坐标系中的二维点。
 */
export class RealtimePoint {
  /**
   * 坐标
   */
  /**
   * 模型输入像素横坐标。
   */
  readonly x: number;

  /**
   * 模型输入像素纵坐标。
   */
  readonly y: number;

  /**
   * 创建模型输入像素坐标点。
   *
   * @param init.x 模型输入像素横坐标。
   * @param init.y 模型输入像素纵坐标。
   */
  constructor(init: RealtimePointInit) {
    this.x = init.x;
    this.y = init.y;
  }
}
