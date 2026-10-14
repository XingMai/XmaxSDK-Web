import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";

/** 输入帧顺时针旋转角度；与前置摄像头的水平镜像独立。 */
export type CameraRotation = 0 | 90 | 180 | 270;

export function validateCameraRotation(rotation: number): asserts rotation is CameraRotation {
  if (![0, 90, 180, 270].includes(rotation)) {
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Camera rotation must be 0, 90, 180 or 270");
  }
}
