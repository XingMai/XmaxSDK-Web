import { describe, expect, it } from "vitest";
import { CameraPosition } from "../src/Foundation/Media/Camera/CameraPosition";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import type { PermissionManaging } from "../src/Foundation/Permissions/PermissionManaging";
import type {
  RtcCameraCaptureOptions,
  RtcManaging,
} from "../src/Foundation/RTC/RtcManaging";
import { CameraController } from "../src/Media/Camera/CameraController";
import { VideoRenderRegistry } from "../src/Service/Realtime/VideoRenderBinding";
import type { XmaxVideoView } from "../src/Render/Video/XmaxVideoView";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { MediaService } from "../src/Service/Media/MediaService";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import type { VideoEncodingConfiguration } from "../src/Foundation/RTC/VideoEncodingConfiguration";

/** Node 环境没有 MediaStream，提供最小实现供预览流逻辑使用。 */
class MediaStreamStub {
  private tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack): void {
    this.tracks = this.tracks.filter((item) => item !== track);
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }
}

(globalThis as Record<string, unknown>).MediaStream ??= MediaStreamStub;

/** 支持 unmute 事件模拟的假视频轨。 */
class FakeMediaStreamTrack {
  readonly id: string;
  muted = true;
  readyState: "live" | "ended" = "live";

  private listeners = new Map<string, Array<() => void>>();

  constructor(id: string) {
    this.id = id;
  }

  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(): void {}

  emit(type: string): void {
    if (type === "unmute") {
      this.muted = false;
    }
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

class RtcManagingStub implements RtcManaging {
  isInitialized = false;
  initializeCalls = 0;
  destroyCalls = 0;
  stopCaptureCalls = 0;
  startCalls: RtcCameraCaptureOptions[] = [];
  switchCalls: CameraPosition[] = [];
  failNextStart?: XmaxError;

  private tracks: FakeMediaStreamTrack[] = [];

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
    this.isInitialized = true;
  }

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
    this.isInitialized = false;
  }

  async startCameraCapture(
    options: RtcCameraCaptureOptions,
  ): Promise<MediaStreamTrack> {
    if (this.failNextStart) {
      const error = this.failNextStart;
      this.failNextStart = undefined;
      throw error;
    }
    this.startCalls.push(options);
    return this.makeTrack();
  }

  async switchCameraCapture(to: CameraPosition): Promise<MediaStreamTrack> {
    this.switchCalls.push(to);
    return this.makeTrack();
  }

  async stopCameraCapture(): Promise<void> {
    this.stopCaptureCalls += 1;
  }

  async configureVideoEncoding(): Promise<void> {}

  encodingConfigurations: VideoEncodingConfiguration[] = [];

  // 房间与发布能力：相机管线测试不涉及，空实现满足接口。
  async joinRoom(): Promise<void> {}
  async leaveRoom(): Promise<void> {}
  async publishLocalVideo(): Promise<void> {}
  async unpublishLocalVideo(): Promise<void> {}
  async publishLocalAudio(): Promise<void> {}
  async unpublishLocalAudio(): Promise<void> {}
  async subscribeRemoteVideo(): Promise<MediaStreamTrack | undefined> {
    return undefined;
  }
  async subscribeRemoteAudio(): Promise<void> {}
  setRemoteAudioVolume(): void {}
  sendRoomMessage(): void {}
  setEventListener(): void {}

  /** 让最近一次采集产出的视频轨收到首帧。 */
  emitFirstFrame(): void {
    this.tracks[this.tracks.length - 1]?.emit("unmute");
  }

  private makeTrack(): MediaStreamTrack {
    const track = new FakeMediaStreamTrack(`track-${this.tracks.length}`);
    this.tracks.push(track);
    return track as unknown as MediaStreamTrack;
  }
}

class PermissionManagingStub implements PermissionManaging {
  cameraGranted = true;
  microphoneGranted = true;

  async ensureCameraPermission(): Promise<void> {
    if (!this.cameraGranted) {
      throw new XmaxError(
        XmaxErrorCode.cameraPermissionDenied,
        "Camera permission was denied",
      );
    }
  }

  async ensureMicrophonePermission(): Promise<void> {
    if (!this.microphoneGranted) {
      throw new XmaxError(
        XmaxErrorCode.microphonePermissionDenied,
        "Microphone permission was denied",
      );
    }
  }
}

function makeController() {
  const rtc = new RtcManagingStub();
  const permission = new PermissionManagingStub();
  const controller = new CameraController({
    permissionManager: permission,
    rtcManager: rtc,
    mediaService: new MediaService(RealtimeModel.x2_fast_1080p),
  });
  return { controller, rtc, permission };
}

function attachPreview(track: { mediaStreamTrack?: MediaStreamTrack } & object) {
  const binding = VideoRenderRegistry.binding(track as never);
  const view = {
    isMirrored: false,
    setMediaStream: () => {},
  } as unknown as XmaxVideoView;
  binding?.attachHandler(view, "fill" as never);
  return view;
}

const defaultFormat = new RealtimeVideoFormat({
  width: 1024,
  height: 1920,
  fps: 30,
});

describe("CameraController", () => {
  it("creates a local camera stream with the resolved format", async () => {
    const { controller, rtc } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });

    expect(stream.videoTrack?.id).toBe("video0");
    expect(stream.videoTrack?.videoFormat?.width).toBe(1024);
    expect(stream.videoTrack?.videoFormat?.height).toBe(1920);
    expect(rtc.initializeCalls).toBe(1);
    expect(rtc.startCalls).toHaveLength(1);
    expect(controller.currentTrack).toBe(stream.videoTrack);
  });

  it("rejects creating a second camera stream while one is active", async () => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });
    await expect(
      controller.createLocalCameraStream({
        videoFormat: defaultFormat,
        position: CameraPosition.front,
        useMicrophone: false,
      }),
    ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
  });

  it("cleans up when capture start fails", async () => {
    const { controller, rtc } = makeController();
    rtc.failNextStart = new XmaxError(XmaxErrorCode.mediaError, "no camera");
    await expect(
      controller.createLocalCameraStream({
        videoFormat: defaultFormat,
        position: CameraPosition.front,
        useMicrophone: false,
      }),
    ).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    expect(controller.currentTrack).toBeUndefined();
    expect(rtc.stopCaptureCalls).toBe(1);
    expect(rtc.destroyCalls).toBe(1);
  });

  it("stops the camera stream, destroys the engine and unregisters the preview binding", async () => {
    const { controller, rtc } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });
    await controller.stopLocalCameraStream();
    expect(controller.currentTrack).toBeUndefined();
    expect(rtc.stopCaptureCalls).toBe(1);
    expect(rtc.destroyCalls).toBe(1);
    expect(VideoRenderRegistry.binding(stream.videoTrack as never)).toBeUndefined();
  });

  it("switches between front and back cameras on the same track", async () => {
    const { controller, rtc } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });
    const previousMediaTrack = stream.videoTrack?.mediaStreamTrack;
    const switched = await controller.switchCamera();
    expect(rtc.switchCalls).toEqual([CameraPosition.back]);
    expect(switched.videoTrack).toBe(stream.videoTrack);
    expect(switched.videoTrack?.position).toBe(CameraPosition.back);
    // 切换后轨道指向 RTC 层产出的新视频轨。
    expect(switched.videoTrack?.mediaStreamTrack).toBeDefined();
    expect(switched.videoTrack?.mediaStreamTrack).not.toBe(previousMediaTrack);
  });

  it("throws when switching without an active stream", async () => {
    const { controller } = makeController();
    await expect(controller.switchCamera()).rejects.toMatchObject({
      code: XmaxErrorCode.rtcError,
    });
  });

  it("fires the preview-ready handler only after the first frame and view attach", async () => {
    const { controller, rtc } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });

    let readyCount = 0;
    controller.setPreviewReadyHandler(() => {
      readyCount += 1;
    });

    // 仅收到首帧：不就绪。
    rtc.emitFirstFrame();
    expect(readyCount).toBe(0);

    // 绑定预览视图后就绪，且只通知一次。
    attachPreview(stream.videoTrack as never);
    expect(readyCount).toBe(1);

    rtc.emitFirstFrame();
    expect(readyCount).toBe(1);
  });

  it("mirrors the preview for the front camera", async () => {
    const { controller } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });
    const view = attachPreview(stream.videoTrack as never);
    expect(view.isMirrored).toBe(true);
  });
});
