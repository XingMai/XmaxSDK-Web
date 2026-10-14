import { vi } from "vitest";

/** 用可控的视频帧回调验证旋转矩阵和生命周期，不访问真实摄像头。 */
export function cameraRotationEnvironment() {
  const callbacks = new Map<number, () => void>();
  let nextID = 0;
  const source = Object.assign(new EventTarget(), {
    kind: "video", readyState: "live", stop: vi.fn(),
  }) as unknown as MediaStreamTrack;
  const output = Object.assign(new EventTarget(), {
    kind: "video", readyState: "live", stop: vi.fn(), requestFrame: vi.fn(),
    getSettings: vi.fn(() => ({ width: 1024, height: 1920, frameRate: 30 })),
  }) as unknown as CanvasCaptureMediaStreamTrack;
  const context = { setTransform: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() };
  const stream = { getVideoTracks: () => [output], getTracks: () => [output] };
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), captureStream: vi.fn(() => stream) };
  const video = {
    videoWidth: 1920, videoHeight: 1024, readyState: 2, srcObject: null,
    muted: false, autoplay: false, playsInline: false,
    play: vi.fn(async () => {}), pause: vi.fn(),
    requestVideoFrameCallback: vi.fn((callback: () => void) => { callbacks.set(++nextID, callback); return nextID; }),
    cancelVideoFrameCallback: vi.fn((id: number) => callbacks.delete(id)),
  };
  vi.stubGlobal("document", { createElement: vi.fn((tag: string) => tag === "video" ? video : canvas) });
  vi.stubGlobal("MediaStream", class { constructor(readonly tracks: MediaStreamTrack[]) {} });
  return { source, output, context, stream, canvas, video, callbacks,
    frame: () => { const current = [...callbacks.values()]; callbacks.clear(); current.forEach(callback => callback()); },
  };
}
