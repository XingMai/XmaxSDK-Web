import { describe, expect, it } from "vitest";
import type {
  CameraCaptureManaging,
  CameraCaptureStartOptions,
} from "../src/Foundation/Media/Camera/CameraCaptureManaging";
import { CameraPosition } from "../src/Foundation/Media/Camera/CameraPosition";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import type { PermissionManaging } from "../src/Foundation/Permissions/PermissionManaging";
import { CameraController } from "../src/Media/Camera/CameraController";
import { VideoRenderRegistry } from "../src/Render/Video/VideoRenderBinding";
import type { XmaxVideoView } from "../src/Render/Video/XmaxVideoView";
import { RealtimeModel } from "../src/Core/Realtime/RealtimeModel";
import { MediaService } from "../src/Service/Media/MediaService";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";

class CameraCaptureManagingStub implements CameraCaptureManaging {
  mediaStream?: MediaStream;
  currentVideoTrack?: MediaStreamTrack;
  startCalls: CameraCaptureStartOptions[] = [];
  switchCalls: CameraPosition[] = [];
  stopCalls = 0;
  failNextStart?: XmaxError;

  private fakeTrack(): MediaStreamTrack {
    return { id: `track-${this.startCalls.length}` } as MediaStreamTrack;
  }

  async start(options: CameraCaptureStartOptions): Promise<MediaStreamTrack> {
    if (this.failNextStart) {
      const error = this.failNextStart;
      this.failNextStart = undefined;
      throw error;
    }
    this.startCalls.push(options);
    const track = this.fakeTrack();
    this.currentVideoTrack = track;
    this.mediaStream = { id: "stream" } as MediaStream;
    return track;
  }

  async switchCamera(to: CameraPosition): Promise<MediaStreamTrack> {
    this.switchCalls.push(to);
    const track = this.fakeTrack();
    this.currentVideoTrack = track;
    return track;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.currentVideoTrack = undefined;
    this.mediaStream = undefined;
  }

  emitFirstFrame(): void {
    this.startCalls[this.startCalls.length - 1]?.firstFrameListener();
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
  const capture = new CameraCaptureManagingStub();
  const permission = new PermissionManagingStub();
  const controller = new CameraController({
    permissionManager: permission,
    captureManager: capture,
    mediaService: new MediaService(RealtimeModel.x2_0),
  });
  return { controller, capture, permission };
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
  width: 832,
  height: 1472,
  fps: 30,
});

describe("CameraController", () => {
  it("creates a local camera stream with the resolved format", async () => {
    const { controller, capture } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });

    expect(stream.videoTrack?.id).toBe("video0");
    expect(stream.videoTrack?.videoFormat?.width).toBe(832);
    expect(stream.videoTrack?.videoFormat?.height).toBe(1472);
    expect(capture.startCalls).toHaveLength(1);
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
    const { controller, capture } = makeController();
    capture.failNextStart = new XmaxError(XmaxErrorCode.mediaError, "no camera");
    await expect(
      controller.createLocalCameraStream({
        videoFormat: defaultFormat,
        position: CameraPosition.front,
        useMicrophone: false,
      }),
    ).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    expect(controller.currentTrack).toBeUndefined();
    expect(capture.stopCalls).toBe(1);
  });

  it("stops the camera stream and unregisters the preview binding", async () => {
    const { controller, capture } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });
    await controller.stopLocalCameraStream();
    expect(controller.currentTrack).toBeUndefined();
    expect(capture.stopCalls).toBe(1);
    expect(VideoRenderRegistry.binding(stream.videoTrack as never)).toBeUndefined();
  });

  it("switches between front and back cameras on the same track", async () => {
    const { controller, capture } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });
    const switched = await controller.switchCamera();
    expect(capture.switchCalls).toEqual([CameraPosition.back]);
    expect(switched.videoTrack).toBe(stream.videoTrack);
    expect(switched.videoTrack?.position).toBe(CameraPosition.back);
  });

  it("throws when switching without an active stream", async () => {
    const { controller } = makeController();
    await expect(controller.switchCamera()).rejects.toMatchObject({
      code: XmaxErrorCode.rtcError,
    });
  });

  it("fires the preview-ready handler only after the first frame and view attach", async () => {
    const { controller, capture } = makeController();
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
    capture.emitFirstFrame();
    expect(readyCount).toBe(0);

    // 绑定预览视图后就绪，且只通知一次。
    attachPreview(stream.videoTrack as never);
    expect(readyCount).toBe(1);

    capture.emitFirstFrame();
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
