import type { ModelSize } from "../../Core/Realtime/RealtimeModel";

/**
 * 定义媒体输入规则与平台媒体能力查询能力。
 * 当前仅包含尺寸规则。
 */
export interface MediaServicing {
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
