import { RealtimeVideoFormat } from "./RealtimeVideoFormat";
import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * SDK 当前支持的实时生成模型。
 */
export enum RealtimeModel {
  x2_0 = "x2.0",
  x2_0_trtc = "x2.0-trtc",
  x2_1_preview = "x2.1-preview",
}

/** 内置模型或服务端新增的模型标识；自定义名称原样传给服务端。 */
export type RealtimeModelName = RealtimeModel | (string & {});

function isKnownModel(model: RealtimeModelName): model is RealtimeModel {
  if (typeof model !== "string" || !model.trim()) {
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Realtime model must be a non-empty string");
  }
  return Object.values(RealtimeModel).includes(model as RealtimeModel);
}

/** 只解析本地默认配置，不替换请求中的模型标识；避免原型属性参与查表。 */
function modelDefaults(model: RealtimeModelName): RealtimeModel {
  return isKnownModel(model) ? model : RealtimeModel.x2_1_preview;
}

/**
 * 模型在界面中展示的名称，与接口使用的模型标识分开维护。
 */
const MODEL_DISPLAY_NAMES: Readonly<Record<RealtimeModel, string>> = {
  [RealtimeModel.x2_0]: "X2.0",
  [RealtimeModel.x2_0_trtc]: "X2.1-preview-trtc",
  [RealtimeModel.x2_1_preview]: "X2.1-preview-agora",
};

/**
 * 模型专用的会话 API 地址；未配置的模型沿用客户端环境地址。
 */
const MODEL_BASE_URLS: Readonly<Partial<Record<RealtimeModel, string>>> = {
  [RealtimeModel.x2_1_preview]: "https://cloud.xmax.22duck.cn/open/api/v1",
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
  [RealtimeModel.x2_0_trtc]: [
    { width: 1024, height: 1920 },
    { width: 1920, height: 1024 },
  ],
  [RealtimeModel.x2_1_preview]: [
    { width: 1024, height: 1920 },
    { width: 1920, height: 1024 },
  ],
};

/**
 * 各模型允许的最大输入像素面积；仅在分辨率桶为空时参与尺寸计算。
 */
const MAXIMUM_INPUT_PIXELS: Record<RealtimeModel, number> = {
  [RealtimeModel.x2_0]: 1280000,
  [RealtimeModel.x2_0_trtc]: 2100000,
  [RealtimeModel.x2_1_preview]: 2100000,
};

/**
 * 获取模型的显示名称。
 */
export function modelDisplayName(model: RealtimeModelName): string {
  return isKnownModel(model) ? MODEL_DISPLAY_NAMES[model] : model;
}

/**
 * 模型专用的会话 API Base URL；未知模型沿用 x2.1-preview 的地址。
 * 已知模型返回 undefined 时使用客户端环境的默认地址。
 */
export function modelBaseURL(model: RealtimeModelName): string | undefined {
  return MODEL_BASE_URLS[modelDefaults(model)];
}

/**
 * 模型支持的输入分辨率桶；空数组表示按像素面积上下限和对齐规则计算输入尺寸。
 */
export function resolutionBuckets(model: RealtimeModelName): ModelSize[] {
  return RESOLUTION_BUCKETS[modelDefaults(model)];
}

/**
 * 输入分辨率的最小总像素面积；仅在分辨率桶为空时参与尺寸计算。
 */
export function minimumInputPixels(_model: RealtimeModelName): number {
  return 600000;
}

/**
 * 输入分辨率的最大总像素面积；仅在分辨率桶为空时参与尺寸计算。
 */
export function maximumInputPixels(model: RealtimeModelName): number {
  return MAXIMUM_INPUT_PIXELS[modelDefaults(model)];
}

/**
 * 输入宽度和高度分别需要对齐的像素倍数；仅在分辨率桶为空时参与尺寸计算。
 */
export function inputSizeAlignment(_model: RealtimeModelName): number {
  return 32;
}

/**
 * 未指定视频规格时，各媒体来源使用的默认帧率。
 */
export function defaultFrameRate(_model: RealtimeModelName): number {
  return 30;
}

/**
 * 摄像头采集使用的默认视频规格。
 */
export function defaultCameraVideoFormat(model: RealtimeModelName): RealtimeVideoFormat {
  if (modelDefaults(model) === RealtimeModel.x2_0) {
    return new RealtimeVideoFormat({ width: 832, height: 1472, fps: 30 });
  }

  return new RealtimeVideoFormat({ width: 1024, height: 1920, fps: 30 });
}

/**
 * 模型支持的 RTC 提供方；第一项为默认值，只读列表防止接入方修改全局能力定义。
 */
const MODEL_RTC_PROVIDERS: Readonly<Record<RealtimeModel, readonly RtcProvider[]>> = {
  [RealtimeModel.x2_0]: Object.freeze([RtcProvider.vertc]),
  [RealtimeModel.x2_0_trtc]: Object.freeze([RtcProvider.trtc]),
  [RealtimeModel.x2_1_preview]: Object.freeze([RtcProvider.agora]),
};

/**
 * 查询 SDK 允许配置的 RTC 提供方，第一项为默认值。
 * 未知模型默认沿用 x2.1-preview 的 Agora，也允许显式选择其他已接入的 RTC；
 * 是否被该模型的服务端支持，由服务端决定。
 */
export function supportedRtcProviders(model: RealtimeModelName): readonly RtcProvider[] {
  return isKnownModel(model) ? MODEL_RTC_PROVIDERS[model] : CUSTOM_MODEL_RTC_PROVIDERS;
}

const CUSTOM_MODEL_RTC_PROVIDERS: readonly RtcProvider[] = Object.freeze([
  ...MODEL_RTC_PROVIDERS[RealtimeModel.x2_1_preview],
  ...Object.values(RtcProvider).filter((provider) =>
    !MODEL_RTC_PROVIDERS[RealtimeModel.x2_1_preview].includes(provider)),
]);
