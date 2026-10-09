import type { StoredFile } from "./StoredFile";

/**
 * 上传图片或视频的参数。
 */
export interface StorageUploadOptions {
  /**
   * 文件数据；File 作为 Blob 的子类可直接传入。
   */
  data: Blob | ArrayBuffer | Uint8Array;

  /**
   * 文件名；用于对象键后缀和缺省内容类型推断。
   */
  fileName: string;

  /**
   * 文件 MIME 类型；缺省按文件名后缀推断。
   */
  contentType?: string;

  /**
   * 上传进度回调（已传字节数、总字节数）。
   */
  onProgress?: (transferred: number, total: number) => void;
}

/**
 * 定义文件存储能力：上传图片或视频到对象存储并返回访问地址。
 */
export interface StorageServicing {
  /**
   * 上传图片。
   *
   * 从 Xmax 服务获取临时凭证后直传对象存储。
   *
   * @returns 已存储文件信息。
   * @throws 参数无效、凭证获取失败或上传失败时抛出错误。
   */
  uploadImage(options: StorageUploadOptions): Promise<StoredFile>;

  /**
   * 上传视频。
   *
   * 从 Xmax 服务获取临时凭证后，通过 COS putObject 普通上传原始文件。
   * 不进行转码、压缩或分片上传；单个文件受 COS 普通上传的 5GB 上限约束。
   *
   * @returns 已存储文件信息。
   * @throws 参数无效、凭证获取失败或上传失败时抛出错误。
   */
  uploadVideo(options: StorageUploadOptions): Promise<StoredFile>;
}
