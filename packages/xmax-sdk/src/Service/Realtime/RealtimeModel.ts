import { RealtimeVideoFormat } from "./RealtimeVideoFormat";
import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * SDK 当前支持的实时生成模型。
 */
export enum RealtimeModel {
  x2_0 = "x2.0",
  x2_0_pro = "x2.0-pro",
  x2_0_trtc = "x2.0-trtc",
  x2_0_agora = "x2.0-agora",
  x2_1_preview = "x2.1-preview",
  x2_1_preview_1005 = "x2.1-preview-1005",
}

/**
 * 模型在界面中展示的名称，与接口使用的模型标识分开维护。
 */
const MODEL_DISPLAY_NAMES: Readonly<Record<RealtimeModel, string>> = {
  [RealtimeModel.x2_0]: "X2.0",
  [RealtimeModel.x2_0_pro]: "X2.0-pro",
  [RealtimeModel.x2_0_trtc]: "X2.1-preview-trtc",
  [RealtimeModel.x2_0_agora]: "X2.1-preview-agora",
  [RealtimeModel.x2_1_preview]: "X2.1-preview-vertc",
  [RealtimeModel.x2_1_preview_1005]: "X2.1-preview-1005",
};

/**
 * 模型专用的会话 API 地址；未配置的模型沿用客户端环境地址。
 */
const MODEL_BASE_URLS: Readonly<Partial<Record<RealtimeModel, string>>> = {
  [RealtimeModel.x2_0_pro]: "https://dev.xmaxai.com/open/api/v1",
  [RealtimeModel.x2_0_agora]: "https://dev.xmaxai.com/open/api/v1",
  [RealtimeModel.x2_1_preview]: "https://dev.xmaxai.com/open/api/v1",
  [RealtimeModel.x2_1_preview_1005]: "https://dev.xmaxai.com/open/api/v1",
};

/**
 * 模型输入画面的像素尺寸。
 */
export interface ModelSize {
  width: number;
  height: number;
}

/**
 * 各模型支持的输入分辨率桶；空数组表示按像素面积上下限和对齐规则计算尺寸。
 */
const RESOLUTION_BUCKETS: Record<RealtimeModel, ModelSize[]> = {
  [RealtimeModel.x2_0]: [],
  [RealtimeModel.x2_0_pro]: [
    { width: 1024, height: 1920 },
    { width: 1920, height: 1024 },
  ],
  [RealtimeModel.x2_0_trtc]: [
    { width: 1024, height: 1920 },
    { width: 1920, height: 1024 },
  ],
  [RealtimeModel.x2_0_agora]: [
    { width: 1024, height: 1920 },
    { width: 1920, height: 1024 },
  ],
  [RealtimeModel.x2_1_preview]: [
    { width: 1024, height: 1920 },
    { width: 1920, height: 1024 },
  ],
  [RealtimeModel.x2_1_preview_1005]: [
    { width: 1024, height: 1920 },
    { width: 1920, height: 1024 },
  ],
};

/**
 * 各模型允许的最大输入像素面积；仅在分辨率桶为空时参与尺寸计算。
 */
const MAXIMUM_INPUT_PIXELS: Record<RealtimeModel, number> = {
  [RealtimeModel.x2_0]: 1280000,
  [RealtimeModel.x2_0_pro]: 2100000,
  [RealtimeModel.x2_0_trtc]: 2100000,
  [RealtimeModel.x2_0_agora]: 2100000,
  [RealtimeModel.x2_1_preview]: 2100000,
  [RealtimeModel.x2_1_preview_1005]: 2100000,
};

/**
 * 获取模型的显示名称。
 */
export function modelDisplayName(model: RealtimeModel): string {
  return MODEL_DISPLAY_NAMES[model];
}

/**
 * 模型专用的会话 API Base URL；undefined 表示使用客户端环境的默认地址。
 */
export function modelBaseURL(model: RealtimeModel): string | undefined {
  return MODEL_BASE_URLS[model];
}

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

/**
 * 模型支持的 RTC 提供方；第一项为默认值，只读列表防止接入方修改全局能力定义。
 */
const MODEL_RTC_PROVIDERS: Readonly<Record<RealtimeModel, readonly RtcProvider[]>> = {
  [RealtimeModel.x2_0]: Object.freeze([RtcProvider.trtc]),
  [RealtimeModel.x2_0_pro]: Object.freeze([RtcProvider.vertc]),
  [RealtimeModel.x2_0_trtc]: Object.freeze([RtcProvider.trtc]),
  [RealtimeModel.x2_0_agora]: Object.freeze([RtcProvider.agora]),
  [RealtimeModel.x2_1_preview]: Object.freeze([RtcProvider.vertc]),
  [RealtimeModel.x2_1_preview_1005]: Object.freeze([RtcProvider.vertc]),
};

/**
 * 查询模型支持的 RTC 提供方，第一项为默认值；未知模型抛出配置错误。
 */
export function supportedRtcProviders(model: RealtimeModel): readonly RtcProvider[] {
  if (!Object.values(RealtimeModel).includes(model)) {
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Unsupported realtime model");
  }
  return MODEL_RTC_PROVIDERS[model];
}
