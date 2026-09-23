import { RealtimeVideoFormat } from "./RealtimeVideoFormat";

/**
 * SDK 当前支持的实时生成模型。
 */
export enum RealtimeModel {
  /**
   * Xmax X2.0 实时生成模型。
   */
  x2_0 = "x2.0",

  /**
   * Xmax X2.0 Pro 实时生成模型。
   */
  x2_0_pro = "x2.0-pro",

  /**
   * Xmax X2 Fast 1080P 实时生成模型。
   */
  x2_fast_1080p = "x2-fast-1080p",
}

export interface ModelSize {
  width: number;
  height: number;
}

const RESOLUTION_BUCKETS: Record<RealtimeModel, ModelSize[]> = {
  [RealtimeModel.x2_0]: [],
  [RealtimeModel.x2_0_pro]: [
    { width: 1024, height: 1920 },
    { width: 1920, height: 1024 },
  ],
  [RealtimeModel.x2_fast_1080p]: [
    { width: 1024, height: 1920 },
    { width: 1920, height: 1024 },
  ],
};

const MAXIMUM_INPUT_PIXELS: Record<RealtimeModel, number> = {
  [RealtimeModel.x2_0]: 1280000,
  [RealtimeModel.x2_0_pro]: 2100000,
  [RealtimeModel.x2_fast_1080p]: 2100000,
};

/**
 * 模型支持的输入分辨率桶；空数组表示按像素面积上下限和对齐规则计算输入尺寸。
 */
export function resolutionBuckets(model: RealtimeModel): ModelSize[] {
  return RESOLUTION_BUCKETS[model];
}

/**
 * 输入分辨率的最小总像素面积；仅在分辨率桶为空时参与尺寸计算。
 */
export function minimumInputPixels(_model: RealtimeModel): number {
  return 600000;
}

/**
 * 输入分辨率的最大总像素面积；仅在分辨率桶为空时参与尺寸计算。
 */
export function maximumInputPixels(model: RealtimeModel): number {
  return MAXIMUM_INPUT_PIXELS[model];
}

/**
 * 输入宽度和高度分别需要对齐的像素倍数；仅在分辨率桶为空时参与尺寸计算。
 */
export function inputSizeAlignment(_model: RealtimeModel): number {
  return 32;
}

/**
 * 未指定视频规格时，各媒体来源使用的默认帧率。
 */
export function defaultFrameRate(_model: RealtimeModel): number {
  return 30;
}

/**
 * 摄像头采集使用的默认视频规格。
 */
export function defaultCameraVideoFormat(model: RealtimeModel): RealtimeVideoFormat {
  if (model === RealtimeModel.x2_0) {
    return new RealtimeVideoFormat({ width: 832, height: 1472, fps: 30 });
  }

  return new RealtimeVideoFormat({ width: 1024, height: 1920, fps: 30 });
}
