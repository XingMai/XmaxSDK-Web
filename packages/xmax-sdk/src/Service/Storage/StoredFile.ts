/**
 * 上传完成后返回的已存储文件信息。
 */
export class StoredFile {
  /**
   * 存储结果
   */
  /**
   * 文件的访问地址。
   */
  readonly url: string;

  /**
   * 对象存储中的对象键。
   */
  readonly objectKey: string;

  /**
   * 对象存储返回的 ETag；未返回时为空。
   */
  readonly etag?: string;

  /**
   * 创建已存储文件信息。
   *
   * @param init.url 文件访问地址。
   * @param init.objectKey 对象键。
   * @param init.etag 对象存储返回的 ETag。
   */
  constructor(init: { url: string; objectKey: string; etag?: string }) {
    this.url = init.url;
    this.objectKey = init.objectKey;
    this.etag = init.etag;
  }
}
