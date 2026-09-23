/**
 * framegen 1.4.0 的 exports 未导出类型声明；限定本 SDK 使用的 texture API。
 */
declare module "framegen" {
  export interface RT {
    prepPair(a: GPUTexture, b: GPUTexture): void;
    runT(t: number, output: GPUTexture): void;
    destroy(): void;
  }
  export function createRT(device: GPUDevice, options: {
    w: number;
    h: number;
    weightsBin: ArrayBuffer;
    weightsManifest: Record<string, { offset: number; shape: number[] }>;
    textureInput: boolean;
    textureOutput: boolean;
    staticGuard: boolean;
  }): Promise<RT>;
}
