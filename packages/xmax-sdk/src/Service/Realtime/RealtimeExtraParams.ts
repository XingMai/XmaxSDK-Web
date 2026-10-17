import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/** 可通过生成信令传递的 JSON 数据。 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 合并到本次 start 或 change_condition 的 params；不缓存，不允许覆盖 SDK 字段。 */
export type RealtimeExtraParams = Record<string, JsonValue>;

const RESERVED_PARAMS = new Set([
  "model", "face_replace", "size", "target_size", "prompt", "ref_image_path",
  "mirror", "ref_video_path", "sample_method", "min_bitrate", "max_bitrate",
]);

/**
 * 校验并复制本次参数；不保存到生成上下文。
 *
 * @param params 本次调用的扩展参数，只接受 JSON 数据。
 * @returns 独立的 JSON 副本；未传参数时返回 undefined。
 * @throws 参数包含非 JSON 数据、循环引用或 SDK 保留字段时抛出 invalidConfiguration。
 */
export function snapshotExtraParams(params?: RealtimeExtraParams): RealtimeExtraParams | undefined {
  if (params === undefined) return undefined;
  const invalid = (message: string): never => {
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, message);
  };
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return invalid("extraParams must be a JSON object");
  }
  for (const key of Object.keys(params)) {
    if (RESERVED_PARAMS.has(key)) return invalid(`extraParams conflicts with SDK parameter: ${key}`);
  }
  const ancestors = new Set<object>();
  const validate = (value: unknown): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || !value) return invalid("extraParams must contain only JSON values");
    if (ancestors.has(value)) return invalid("extraParams must not contain circular references");
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      return invalid("extraParams must contain only JSON objects and arrays");
    }
    if (Object.getOwnPropertySymbols(value).length) return invalid("extraParams must not contain symbol keys");
    ancestors.add(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) validate(child);
    ancestors.delete(value);
  };
  validate(params);
  return JSON.parse(JSON.stringify(params)) as RealtimeExtraParams;
}
