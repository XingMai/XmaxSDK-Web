// Core
export { XmaxClient } from "./Core/XmaxClient";
export { XmaxConfiguration } from "./Core/XmaxConfiguration";
export type { XmaxConfigurationInit } from "./Core/XmaxConfiguration";

// Core / Realtime
export { RealtimeConfiguration } from "./Core/Realtime/RealtimeConfiguration";
export type { RealtimeConfigurationInit } from "./Core/Realtime/RealtimeConfiguration";
export type { XmaxRealtimeManaging } from "./Core/Realtime/XmaxRealtimeManaging";

// Foundation
export { XmaxError, XmaxErrorCode } from "./Foundation/Errors/XmaxError";
export type { XmaxErrorListener } from "./Foundation/Errors/XmaxError";
export { XmaxLogger, XmaxLoggerOption } from "./Foundation/Logging/XmaxLogger";
export { CameraPosition } from "./Foundation/Media/Camera/CameraPosition";
export { VideoContentMode } from "./Foundation/Media/Video/VideoContentMode";
export { XmaxEnvironment, apiBaseURL } from "./Foundation/Runtime/XmaxEnvironment";

// Service / Realtime
export type {
  RealtimeLaunchTiming,
  RealtimeLaunchTimingListener,
} from "./Service/Realtime/RealtimeLaunchTiming";
export { RealtimeContext } from "./Service/Realtime/RealtimeContext";
export type { RealtimeContextInit } from "./Service/Realtime/RealtimeContext";
export { RealtimeMediaStream } from "./Service/Realtime/RealtimeMediaStream";
export {
  RealtimeModel,
  defaultCameraVideoFormat,
  defaultFrameRate,
} from "./Service/Realtime/RealtimeModel";
export {
  RealtimeConnectionState,
  RealtimeReason,
  RealtimeState,
} from "./Service/Realtime/RealtimeState";
export type { RealtimeStateListener } from "./Service/Realtime/RealtimeState";
export {
  RealtimeVideoEncoderPreference,
  RealtimeVideoFormat,
} from "./Service/Realtime/RealtimeVideoFormat";
export type { RealtimeVideoFormatInit } from "./Service/Realtime/RealtimeVideoFormat";
export { RealtimeVideoTrack } from "./Service/Realtime/RealtimeVideoTrack";

// Service / Media
export { MediaService } from "./Service/Media/MediaService";
export type { MediaServicing } from "./Service/Media/MediaServicing";

// Service / Storage
export { StorageService } from "./Service/Storage/StorageService";
export type {
  StorageServicing,
  StorageUploadOptions,
} from "./Service/Storage/StorageServicing";
export { StoredFile } from "./Service/Storage/StoredFile";

// Render
export { XmaxVideoView } from "./Render/Video/XmaxVideoView";
export { XmaxRealtimeVideoView } from "./Render/Video/XmaxRealtimeVideoView";
