import {
  inputSizeAlignment,
  maximumInputPixels,
  minimumInputPixels,
  RealtimeModel,
  resolutionBuckets,
  type ModelSize,
} from "../Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { MediaServicing } from "./MediaServicing";

/**
 * 提供模型输入尺寸和平台媒体能力相关的业务规则。
 * 当前仅包含 resolveModelInputSize。
 */
export class MediaService implements MediaServicing {
  // 模型约束
  readonly model: RealtimeModel;

  /**
   * 创建媒体服务。
   *
   * @param model 媒体输入规则使用的模型，默认为 `x2-fast-1080p`。
   */
  constructor(model: RealtimeModel = RealtimeModel.x2_fast_1080p) {
    this.model = model;
  }

  resolveModelInputSize(size: ModelSize): ModelSize {
    const buckets = resolutionBuckets(this.model);
    if (buckets.length > 0) {
      const matched = buckets.some(
        (bucket) => bucket.width === size.width && bucket.height === size.height,
      );
      if (!matched) {
        const supportedSizes = buckets
          .map((bucket) => `${bucket.width}×${bucket.height}`)
          .join(", ");
        throw new XmaxError(
          XmaxErrorCode.invalidConfiguration,
          `Model ${this.model} does not support input resolution ` +
            `${size.width}×${size.height}. Supported resolutions: ${supportedSizes}`,
        );
      }
      return { width: size.width, height: size.height };
    }

    const validated = this.validatedSize(size);
    const pixels = validated.width * validated.height;
    const minimumPixels = minimumInputPixels(this.model);
    const maximumPixels = maximumInputPixels(this.model);

    let scale: number;
    let rounding: (value: number) => number;
    if (pixels < minimumPixels) {
      scale = Math.sqrt(minimumPixels / pixels);
      rounding = Math.ceil;
    } else if (pixels > maximumPixels) {
      scale = Math.sqrt(maximumPixels / pixels);
      rounding = Math.floor;
    } else {
      scale = 1;
      rounding = Math.round;
    }

    const alignment = inputSizeAlignment(this.model);
    const width = Math.max(
      rounding((validated.width * scale) / alignment) * alignment,
      alignment,
    );
    const height = Math.max(
      rounding((validated.height * scale) / alignment) * alignment,
      alignment,
    );
    const alignedPixels = width * height;
    if (alignedPixels >= minimumPixels && alignedPixels <= maximumPixels) {
      return { width, height };
    }

    // 对齐可能使边界附近的尺寸越界，选择满足面积限制且最接近目标的尺寸。
    return this.boundedAlignedSize(
      validated.width * scale,
      validated.height * scale,
    );
  }

  /** 在对齐网格上选择满足面积限制且最接近目标的尺寸。 */
  private boundedAlignedSize(width: number, height: number): ModelSize {
    const alignment = inputSizeAlignment(this.model);
    const unitPixels = alignment * alignment;
    const minimumUnits = Math.ceil(minimumInputPixels(this.model) / unitPixels);
    const maximumUnits = Math.floor(maximumInputPixels(this.model) / unitPixels);
    let bestSize: ModelSize = { width: 0, height: 0 };
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let widthUnits = 1; widthUnits <= maximumUnits; widthUnits += 1) {
      const minimumHeight = Math.ceil(minimumUnits / widthUnits);
      const maximumHeight = Math.floor(maximumUnits / widthUnits);
      if (minimumHeight > maximumHeight) {
        continue;
      }
      const heightUnits = Math.min(
        Math.max(Math.round(height / alignment), minimumHeight),
        maximumHeight,
      );
      const candidateWidth = widthUnits * alignment;
      const candidateHeight = heightUnits * alignment;
      const distance =
        ((candidateWidth - width) / width) ** 2 +
        ((candidateHeight - height) / height) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSize = { width: candidateWidth, height: candidateHeight };
      }
    }
    return bestSize;
  }

  /** 校验尺寸为有限正数，并归一化为不小于 1 的整数。 */
  private validatedSize(size: ModelSize): ModelSize {
    if (
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      size.width <= 0 ||
      size.height <= 0
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Image width and height must be finite numbers greater than zero",
      );
    }
    return {
      width: Math.max(Math.round(size.width), 1),
      height: Math.max(Math.round(size.height), 1),
    };
  }
}
