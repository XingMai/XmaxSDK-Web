import type { StoredFile } from "./StoredFile";

/** 上传图片的参数。 */
export interface StorageUploadOptions {
  /** 图片数据。 */
  data: Blob | ArrayBuffer | Uint8Array;

  /** 文件名；用于对象键后缀和缺省内容类型推断。 */
  fileName: string;

  /** 图片 MIME 类型；缺省按文件名后缀推断。 */
  contentType?: string;

  /** 上传进度回调（已传字节数、总字节数）。 */
  onProgress?: (transferred: number, total: number) => void;
}

/**
 * 定义文件存储能力：上传图片到对象存储并返回访问地址。
 */
export interface StorageServicing {
  /**
   * 上传图片。
   *
   * 从 Xmax 服务获取临时凭证后直传对象存储，返回的地址可用作
   * 实时生成的参考图路径。
   *
   * @returns 已存储文件信息。
   * @throws 参数无效、凭证获取失败或上传失败时抛出错误。
   */
  uploadImage(options: StorageUploadOptions): Promise<StoredFile>;
}
