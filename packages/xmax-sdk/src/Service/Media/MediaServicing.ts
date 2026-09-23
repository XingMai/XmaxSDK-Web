import type { ModelSize } from "../Realtime/RealtimeModel";

/**
 * 定义媒体输入规则与平台媒体能力查询能力。
 */
export interface MediaServicing {
  /**
   * 校验并保留原始尺寸；Web 插帧不降低回传分辨率。
   */
  resolveFrameInterpolationSize(size: ModelSize): ModelSize;
  /**
   * 异步判断平台是否支持指定尺寸的插帧；不代表运行期性能保证。
   */
  supportsFrameInterpolation(size: ModelSize): Promise<boolean>;
  /**
   * 按模型输入规则解析目标尺寸。
   *
   * 分辨率桶非空时必须精确匹配；否则按像素面积上下限等比缩放并对齐到
   * 模型要求的像素倍数。
   *
   * @throws 尺寸无效或不满足模型约束时抛出错误。
   */
  resolveModelInputSize(size: ModelSize): ModelSize;
}
