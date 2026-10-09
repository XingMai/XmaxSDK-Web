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
 * 定义图片、视频上传和视频下载能力。
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

  /**
   * 下载完整视频文件并触发浏览器保存；跨域地址需要允许 CORS。
   *
   * @param options.url 可直接访问的 HTTP(S) 视频地址。
   * @param options.fileName 保存时建议使用的文件名。
   * @param options.signal 用于取消网络下载的信号。
   * @returns 文件读取完成并已触发浏览器保存，不代表文件已写入磁盘。
   * @throws 参数无效、非浏览器环境、下载失败或主动取消时抛出错误。
   */
  downloadVideo(options: {
    url: string;
    fileName: string;
    signal?: AbortSignal;
  }): Promise<void>;
}
