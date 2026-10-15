import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrajectoryOverlayView } from "../src/Render/Trajectory/TrajectoryOverlayView";
import { TrajectoryBinding } from "../src/Render/Trajectory/TrajectoryBinding";
import { TrajectoryRegistry } from "../src/Render/Trajectory/TrajectoryRegistry";
import { DefaultTrajectoryEffectRenderer } from "../src/Render/Trajectory/DefaultTrajectoryEffectRenderer";
import { RenderController } from "../src/Render/RenderController";
import { XmaxVideoView } from "../src/Render/Video/XmaxVideoView";
import { RealtimeVideoTrack } from "../src/Service/Realtime/RealtimeVideoTrack";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { VideoContentMode } from "../src/Foundation/Media/Video/VideoContentMode";
import type { TrajectoryEffectRendering } from "../src/Render/Trajectory/TrajectoryEffectRendering";

class Element extends EventTarget {
  style: Record<string, string> = {};
  children: Element[] = [];
  parent?: Element;
  rect = { left: 10, top: 20, width: 200, height: 100 };
  captures = new Set<number>();
  srcObject: unknown = null;
  width = 0;
  height = 0;
  context = {
    ...Object.fromEntries(["clearRect", "fillRect", "save", "restore", "scale", "beginPath", "moveTo", "lineTo", "stroke", "arc", "fill"].map(name => [name, vi.fn()])),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  } as Record<string, ReturnType<typeof vi.fn>>;
  appendChild(child: Element) { child.remove(); this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture(id: number) { this.captures.add(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  getContext() { return this.context; }
  getAttribute() { return null; }
  removeAttribute() {}
  requestVideoFrameCallback() { return 1; }
  cancelVideoFrameCallback() {}
}

let frames: Map<number, FrameRequestCallback>;
let doc: EventTarget & { hidden: boolean; createElement: () => Element };
const format = new RealtimeVideoFormat({ width: 1920, height: 1024, fps: 30 });

beforeEach(() => {
  frames = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (frameID: number) => frames.delete(frameID));
  doc = Object.assign(new EventTarget(), { hidden: false, createElement: () => new Element() });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("MediaStream", class { constructor(readonly tracks: unknown[]) {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function tick(now: number) {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(now));
}

function pointer(element: HTMLElement, type: string, id = 1, x = 110, y = 70, button = 0) {
  const event = Object.assign(new Event(type, { cancelable: true }), { pointerId: id, clientX: x, clientY: y, button });
  element.dispatchEvent(event);
  return event;
}

function makeRenderer() {
  return {
    element: new Element() as unknown as HTMLElement,
    renderBegan: vi.fn(), renderMoved: vi.fn(), renderEnded: vi.fn(), reset: vi.fn(),
  } satisfies TrajectoryEffectRendering;
}

function setup() {
  const send = vi.fn();
  const renderer = makeRenderer();
  const overlay = new TrajectoryOverlayView(renderer);
  const binding = new TrajectoryBinding(send, format);
  binding.attach(overlay);
  binding.update(true);
  return { send, renderer, overlay, binding };
}

describe("TrajectoryOverlayView", () => {
  it("samples immediately, limits frequency and sends stationary multiple pointers together", () => {
    const { overlay, send, renderer } = setup();
    const now = performance.now();
    pointer(overlay.element, "pointerdown");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ points: [{ x: 100, y: 50 }], viewportSize: { width: 200, height: 100 } }));
    for (let i = 0; i < 20; i++) pointer(overlay.element, "pointermove", 1, 90 + i, 60);
    expect(send).toHaveBeenCalledTimes(1);
    tick(now + 10);
    expect(send).toHaveBeenCalledTimes(1);
    pointer(overlay.element, "pointerdown", 2, 50, 60);
    expect(send.mock.calls.at(-1)![0].points).toHaveLength(2);
    tick(now + 80);
    expect(send).toHaveBeenCalledTimes(3);
    expect(renderer.renderMoved).toHaveBeenCalledTimes(20);
    pointer(overlay.element, "pointerup");
    tick(now + 120);
    expect(send.mock.calls.at(-1)![0].points).toEqual([{ x: 40, y: 40 }]);
    pointer(overlay.element, "pointerup", 2);
    expect(frames.size).toBe(0);
    overlay.dispose();
  });

  it("ignores non-primary buttons and letterbox margins, clamps captured motion", () => {
    const { overlay, send } = setup();
    overlay.configure(VideoContentMode.fit, true, true);
    pointer(overlay.element, "pointerdown", 1, 110, 70, 2);
    pointer(overlay.element, "pointerdown", 1, 10, 70);
    expect(send).not.toHaveBeenCalled();
    pointer(overlay.element, "pointerdown");
    pointer(overlay.element, "pointermove", 1, -100, -100);
    tick(performance.now() + 50);
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ mirrored: true, points: [{ x: 6.25, y: 0 }] });
    overlay.dispose();
  });

  it.each(["pointercancel", "lostpointercapture"])("releases all sampling resources on %s", event => {
    const { overlay, renderer } = setup();
    pointer(overlay.element, "pointerdown");
    pointer(overlay.element, event);
    expect(frames.size).toBe(0);
    expect((overlay.element as unknown as Element).captures.size).toBe(0);
    expect(renderer.renderEnded).toHaveBeenCalledOnce();
    overlay.dispose();
  });

  it.each(["disable", "unbind", "hidden", "resize", "mode", "dispose"])("cancels gestures and animations on %s", action => {
    const { overlay, binding, send, renderer } = setup();
    pointer(overlay.element, "pointerdown");
    if (action === "disable") overlay.configure(VideoContentMode.fill, false, false);
    if (action === "unbind") binding.invalidate();
    if (action === "hidden") { doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange")); }
    if (action === "resize") { (overlay.element as unknown as Element).rect.width = 100; tick(performance.now() + 50); }
    if (action === "mode") overlay.configure(VideoContentMode.fit, false, true);
    if (action === "dispose") overlay.dispose();
    expect(frames.size).toBe(0);
    expect((overlay.element as unknown as Element).captures.size).toBe(0);
    expect(renderer.reset).toHaveBeenCalled();
    pointer(overlay.element, "pointermove");
    tick(performance.now() + 100);
    expect(send).toHaveBeenCalledTimes(1);
    overlay.dispose();
  });

  it("does not let custom renderer failures prevent sampling", () => {
    const { overlay, renderer, send } = setup();
    renderer.renderBegan.mockImplementation(() => { throw Error("renderer"); });
    pointer(overlay.element, "pointerdown");
    expect(send).toHaveBeenCalledOnce();
    overlay.dispose();
  });
});

describe("Trajectory bindings and video views", () => {
  it("restores interaction after media resumes, but never revives an ended task", () => {
    const render = new RenderController();
    const track = new RealtimeVideoTrack({ id: "remote", videoFormat: format });
    const send = vi.fn();
    render.registerRemoteTrack(track, send);
    const binding = TrajectoryRegistry.binding(track)!;
    const frame = { points: [{ x: 50, y: 50 }], viewportSize: { width: 100, height: 100 }, contentMode: VideoContentMode.fill, mirrored: false };

    render.setInteractionEnabled(true);
    binding.submit(frame);
    render.setRemoteMedia(null);
    binding.submit(frame);
    expect(send).toHaveBeenCalledOnce();

    render.setRemoteMedia({} as MediaStreamTrack);
    binding.submit(frame);
    expect(send).toHaveBeenCalledTimes(2);

    render.setInteractionEnabled(false);
    render.setRemoteMedia({} as MediaStreamTrack);
    binding.submit(frame);
    expect(send).toHaveBeenCalledTimes(2);
    render.resetRemoteTrack();
  });

  it("does not allocate an overlay for local tracks and lazily attaches one for remote tracks", () => {
    const view = new XmaxVideoView();
    const local = new RealtimeVideoTrack({ id: "local" });
    local.mediaStreamTrack = {} as MediaStreamTrack;
    view.track = local;
    expect((view.element as unknown as Element).children).toHaveLength(1);
    const remote = new RealtimeVideoTrack({ id: "remote", videoFormat: format });
    const render = new RenderController();
    const send = vi.fn();
    render.registerRemoteTrack(remote, send);
    view.trajectoryRenderer = makeRenderer();
    view.track = remote;
    expect((view.element as unknown as Element).children).toHaveLength(2);
    const overlay = (view.element as unknown as Element).children[1]! as unknown as HTMLElement;
    pointer(overlay, "pointerdown");
    expect(send).not.toHaveBeenCalled();
    render.setInteractionEnabled(true, format);
    pointer(overlay, "pointerdown");
    expect(send).toHaveBeenCalledOnce();
    view.isInteractionEnabled = false;
    pointer(overlay, "pointerdown");
    expect(send).toHaveBeenCalledOnce();
    view.detach();
    expect(frames.size).toBe(0);
    view.attach(new Element() as unknown as HTMLElement);
    view.isInteractionEnabled = true;
    const nextOverlay = (view.element as unknown as Element).children[1]! as unknown as HTMLElement;
    pointer(nextOverlay, "pointerdown");
    expect(send).toHaveBeenCalledTimes(2);
    render.resetRemoteTrack();
    expect(frames.size).toBe(0);
    pointer(nextOverlay, "pointerdown");
    expect(send).toHaveBeenCalledTimes(2);
    view.detach();
  });

  it("keeps interaction ownership when an old view detaches and invalidates replacement bindings", () => {
    const { overlay, binding, send } = setup();
    const next = new TrajectoryOverlayView(makeRenderer());
    binding.attach(next);
    overlay.dispose();
    pointer(next.element, "pointerdown");
    expect(send).toHaveBeenCalledOnce();
    const track = new RealtimeVideoTrack({ id: "same-id", videoFormat: format });
    TrajectoryRegistry.register(track, binding);
    TrajectoryRegistry.register(track, new TrajectoryBinding(vi.fn(), format));
    pointer(next.element, "pointerdown");
    expect(send).toHaveBeenCalledOnce();
    const other = new RealtimeVideoTrack({ id: "same-id", videoFormat: format });
    expect(TrajectoryRegistry.binding(other)).toBeUndefined();
    next.dispose();
    TrajectoryRegistry.unregister(track);
  });

  it("uses current mirrored display and resets only the overlay when replacing a renderer", () => {
    const render = new RenderController();
    const track = new RealtimeVideoTrack({ id: "remote", videoFormat: format });
    const send = vi.fn();
    render.registerRemoteTrack(track, send);
    render.setInteractionEnabled(true);
    const view = new XmaxVideoView();
    const first = makeRenderer(), second = makeRenderer();
    view.trajectoryRenderer = first;
    view.track = track;
    view.isMirrored = true;
    view.videoContentMode = VideoContentMode.fit;
    view.trajectoryRenderer = second;
    const overlay = (view.element as unknown as Element).children[1]! as unknown as HTMLElement;
    pointer(overlay, "pointerdown");
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ mirrored: true, contentMode: VideoContentMode.fit }));
    expect(first.reset).toHaveBeenCalled();
    expect(second.renderBegan).toHaveBeenCalledOnce();
    expect(view.videoElement.style.transform).toBe("scaleX(-1)");
    view.detach();
    render.resetRemoteTrack();
  });
});

describe("DefaultTrajectoryEffectRenderer", () => {
  it("draws and fades independently, then releases its animation", () => {
    const renderer = new DefaultTrajectoryEffectRenderer();
    const point = { id: 1, location: { x: 50, y: 50 }, normalizedLocation: { x: .5, y: .5 }, timestamp: performance.now() };
    renderer.renderBegan([point]);
    renderer.renderMoved([{ ...point, location: { x: 60, y: 50 } }]);
    tick(performance.now());
    const [trail, effects] = (renderer.element as unknown as Element).children;
    const context = trail!.context;
    expect(context.stroke).toHaveBeenCalledTimes(3);
    expect(effects!.context.stroke).toHaveBeenCalledTimes(2);
    expect(effects!.context.createRadialGradient).toHaveBeenCalledTimes(5);
    renderer.renderEnded([1]);
    tick(performance.now() + 16);
    expect(context.fillRect).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalledTimes(3);
    expect(effects!.context.createRadialGradient).toHaveBeenCalledTimes(5);
    expect(frames.size).toBe(1);
    for (let index = 0; index < 64; index++) {
      tick(performance.now() + 32 + index * 16);
    }
    expect(frames.size).toBe(0);
    renderer.renderBegan([point]);
    renderer.reset();
    expect(frames.size).toBe(0);
    expect(context.clearRect).toHaveBeenCalled();
  });

  it("uses three additive layers at device resolution and omits decoration for multiple pointers", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const renderer = new DefaultTrajectoryEffectRenderer();
    const [trail, effects] = (renderer.element as unknown as Element).children;
    const context = trail!.context as unknown as CanvasRenderingContext2D;
    const layers: unknown[] = [];
    trail!.context.stroke!.mockImplementation(() => {
      layers.push([context.lineWidth, context.shadowBlur, context.strokeStyle, context.globalCompositeOperation]);
    });
    const point = { id: 1, location: { x: 50, y: 50 }, normalizedLocation: { x: .5, y: .5 }, timestamp: performance.now() };
    renderer.renderBegan([point]);
    renderer.renderMoved([{ ...point, location: { x: 60, y: 50 } }]);
    tick(performance.now());
    expect(layers).toEqual([
      [36, 24, "rgba(0,255,100,0.35)", "lighter"],
      [20, 12, "rgba(0,255,100,0.75)", "lighter"],
      [6, 0, "rgba(255,255,255,1)", "lighter"],
    ]);
    expect(trail!.context.moveTo).toHaveBeenCalledWith(100, 100);
    expect(trail!.width).toBe(400);

    layers.length = 0;
    effects!.context.stroke!.mockClear();
    effects!.context.createRadialGradient!.mockClear();
    renderer.renderBegan([{ ...point, id: 2 }]);
    renderer.renderMoved([{ ...point, location: { x: 70, y: 50 } }]);
    tick(performance.now());
    expect(layers).toEqual([
      [36, 0, "rgba(0,255,100,0.35)", "lighter"],
      [20, 0, "rgba(0,255,100,0.75)", "lighter"],
      [6, 0, "rgba(255,255,255,1)", "lighter"],
    ]);
    expect(effects!.context.stroke).not.toHaveBeenCalled();
    expect(effects!.context.createRadialGradient).toHaveBeenCalledTimes(2);
    renderer.reset();
    expect(frames.size).toBe(0);
  });
});
