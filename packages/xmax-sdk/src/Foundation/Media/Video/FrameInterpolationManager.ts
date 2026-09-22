/// <reference types="@webgpu/types" />
/// <reference path="./FramegenRuntime.d.ts" />
import { createRT, type RT } from "framegen";
import type { ModelSize } from "../../../Service/Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { frameInterpolationAdapter } from "./FrameInterpolationSupport";
import { weightsBase64, weightsManifest } from "./FramegenWeights.generated";

export interface FrameInterpolationProcessing {
  /** 将视频当前帧拷入原帧环形缓冲，返回纹理槽位。 */
  capture(video: HTMLVideoElement): number;
  /** 在两个原帧槽位之间生成中间帧，返回中间帧槽位。 */
  interpolate(previous: number, current: number): Promise<number>;
  /** 将指定槽位的纹理绘制到画布。 */
  present(slot: number): void;
  destroy(): void;
}

let weights: ArrayBuffer | undefined;
function modelWeights(): ArrayBuffer {
  if (!weights) {
    const decoded = atob(weightsBase64);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    weights = bytes.buffer;
  }
  return weights;
}

const VERTEX = `
struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Output {
  let pos = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var out: Output;
  out.position = vec4f(pos[i], 0, 1);
  out.uv = vec2f((pos[i].x + 1) * 0.5, (1 - pos[i].y) * 0.5);
  return out;
}`;

/** 每条远端视图持有独立 Device；中途初始化失败也能完整回收 runtime 的内部资源。 */
export class FrameInterpolationManager implements FrameInterpolationProcessing {
  /** 原帧环形缓冲的槽位数；中间帧双缓冲紧随其后，显示中的纹理不会被覆写。 */
  static readonly originalSlots = 4;
  private runtime?: RT;
  private textures: GPUTexture[] = [];
  private nextOriginal = 0;
  private nextMidpoint = 0;
  private capturePipeline!: GPURenderPipeline;
  private displayPipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;
  private context!: GPUCanvasContext;
  private destroyed = false;
  private readonly onGPUError = (event: GPUUncapturedErrorEvent) => {
    event.preventDefault();
    if (!this.destroyed) this.onFailure(new Error(event.error.message));
  };

  private constructor(
    private readonly device: GPUDevice,
    private readonly canvas: HTMLCanvasElement,
    private readonly size: ModelSize,
    private readonly onFailure: (error: unknown) => void,
  ) {}

  static async create(canvas: HTMLCanvasElement, size: ModelSize, onFailure: (error: unknown) => void,
    signal: AbortSignal): Promise<FrameInterpolationManager> {
    const ensureActive = () => {
      if (signal.aborted) throw new XmaxError(XmaxErrorCode.cancelled, "Interpolation initialization cancelled");
    };
    const adapter = await frameInterpolationAdapter(size);
    ensureActive();
    if (!adapter) throw new XmaxError(XmaxErrorCode.frameInterpolationUnsupported, "WebGPU shader-f16 is unavailable");
    const device = await adapter.requestDevice({ requiredFeatures: ["shader-f16"] });
    const manager = new FrameInterpolationManager(device, canvas, size, onFailure);
    const abort = () => manager.destroy();
    signal.addEventListener("abort", abort, { once: true });
    device.addEventListener("uncapturederror", manager.onGPUError);
    void device.lost.then((info) => {
      if (!manager.destroyed) onFailure(new Error(`Interpolation GPU device lost: ${info.message}`));
    });
    try {
      ensureActive();
      await manager.initialize();
      ensureActive();
      return manager;
    } catch (error) {
      manager.destroy();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  private async initialize(): Promise<void> {
    const { device, canvas, size } = this;
    const w = Math.ceil(size.width / 16) * 16;
    const h = Math.ceil(size.height / 16) * 16;
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("WebGPU canvas is unavailable");
    this.context = context;
    canvas.width = size.width;
    canvas.height = size.height;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    device.pushErrorScope("validation");
    try {
      const runtime = await createRT(device, {
        w, h, weightsBin: modelWeights(), weightsManifest,
        textureInput: true, textureOutput: true, staticGuard: true,
      });
      if (this.destroyed) {
        runtime.destroy();
        throw new Error("Interpolation initialization cancelled");
      }
      this.runtime = runtime;
      // 四张原帧环形缓冲加两张中间帧输出，显示滞后时也不会覆写屏幕上的纹理。
      for (let i = 0; i < FrameInterpolationManager.originalSlots + 2; i++) {
        this.textures.push(device.createTexture({
          size: [w, h], format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING,
        }));
      }
      this.sampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });
      // 将原始视频拷入 GPU 纹理，并复制边缘像素补齐 /16；不做 CPU readback。
      const captureCode = VERTEX + `
@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var src: texture_external;
@fragment fn fragment(@location(0) uv: vec2f) -> @location(0) vec4f {
  let coords = clamp(uv * vec2f(${w}.0 / ${size.width}.0, ${h}.0 / ${size.height}.0),
    vec2f(0.5 / ${size.width}.0, 0.5 / ${size.height}.0),
    vec2f(1.0 - 0.5 / ${size.width}.0, 1.0 - 0.5 / ${size.height}.0));
  return textureSampleBaseClampToEdge(src, smp, coords);
}`;
      const displayCode = VERTEX + `
@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;
@fragment fn fragment(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(src, smp, uv * vec2f(${size.width}.0 / ${w}.0, ${size.height}.0 / ${h}.0));
}`;
      const pipeline = (code: string, target: GPUTextureFormat) => {
        const module = device.createShaderModule({ code });
        return device.createRenderPipelineAsync({
          layout: "auto", vertex: { module, entryPoint: "vertex" },
          fragment: { module, entryPoint: "fragment", targets: [{ format: target }] },
          primitive: { topology: "triangle-list" },
        });
      };
      [this.capturePipeline, this.displayPipeline] = await Promise.all([
        pipeline(captureCode, "rgba8unorm"), pipeline(displayCode, format),
      ]);
      await device.queue.onSubmittedWorkDone();
    } finally {
      const error = await device.popErrorScope();
      if (error) throw new Error(error.message);
    }
  }

  capture(video: HTMLVideoElement): number {
    const slot = this.nextOriginal;
    this.nextOriginal = (this.nextOriginal + 1) % FrameInterpolationManager.originalSlots;
    this.draw(this.capturePipeline, this.device.importExternalTexture({ source: video }), this.textures[slot]!.createView());
    return slot;
  }

  async interpolate(previous: number, current: number): Promise<number> {
    const slot = FrameInterpolationManager.originalSlots + this.nextMidpoint;
    this.nextMidpoint = 1 - this.nextMidpoint;
    this.runtime!.prepPair(this.textures[previous]!, this.textures[current]!);
    this.runtime!.runT(0.5, this.textures[slot]!);
    await this.device.queue.onSubmittedWorkDone();
    return slot;
  }

  present(slot: number): void {
    this.presentTexture(this.textures[slot]!);
  }

  private presentTexture(texture: GPUTexture): void {
    this.draw(this.displayPipeline, texture.createView(), this.context.getCurrentTexture().createView());
  }

  private draw(pipeline: GPURenderPipeline, source: GPUExternalTexture | GPUTextureView, target: GPUTextureView): void {
    const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: this.sampler }, { binding: 1, resource: source },
    ] });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: "clear", storeOp: "store" }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.device.removeEventListener("uncapturederror", this.onGPUError);
    this.runtime?.destroy();
    this.runtime = undefined;
    this.textures.forEach((texture) => texture.destroy());
    this.textures = [];
    this.context?.unconfigure();
    this.device.destroy();
  }
}
