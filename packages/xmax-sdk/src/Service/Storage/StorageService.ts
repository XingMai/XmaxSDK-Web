import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { ApiServicing } from "../Network/ApiServicing";
import { StoredFile } from "./StoredFile";
import type { StorageServicing, StorageUploadOptions } from "./StorageServicing";

/**
 * `/cos/sts` 返回的临时存储配置。
 */
interface TemporaryStoragePayload {
  bucket?: string;
  region?: string;
  endpoint?: string;
  prefix?: string;
  credentials?: {
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
  };
}

/**
 * 解析后的临时存储配置。
 */
interface TemporaryStorageConfiguration {
  bucket: string;
  region: string;
  endpoint?: string;
  prefix: string;
  credentials: {
    accessKeyID: string;
    secretAccessKey: string;
    sessionToken: string;
  };
}

/**
 * 对象存储直传客户端需要的最小接口。
 */
export interface StorageObjectClient {
  /**
   * 将文件直传到指定桶和对象键，通过回调报告错误或访问地址，并可上报上传进度。
   */
  putObject(
    params: {
      Bucket: string;
      Region: string;
      Key: string;
      Body: Blob;
      ContentType: string;
      onProgress?: (info: { loaded: number; total: number }) => void;
    },
    callback: (
      error: { message?: string } | null,
      data?: { Location?: string; ETag?: string },
    ) => void,
  ): void;
}

/**
 * 对象存储客户端工厂；生产实现按临时凭证创建 COS 客户端。
 */
export type StorageObjectClientFactory = (
  configuration: TemporaryStorageConfiguration,
) => Promise<StorageObjectClient>;

export interface StorageServiceOptions {
  /**
   * Xmax API 请求组件。
   */
  apiService: ApiServicing;

  /**
   * 对象存储客户端工厂（可替换，测试用）。
   */
  clientFactory?: StorageObjectClientFactory;

  /**
   * 时间来源（可替换，测试用）。
   */
  dateGenerator?: () => Date;

  /**
   * 标识来源（可替换，测试用）。
   */
  identifierGenerator?: () => string;
}

/**
 * 文件后缀到内容类型的映射。
 */
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
};

/**
 * 管理文件上传到对象存储。
 *
 * 上传直传不经过 Xmax 服务中转：先通过 `GET /cos/sts` 获取临时凭证，
 * 再用临时凭证创建 COS 客户端直传；访问地址按 `Location`、自定义
 * endpoint 或默认 COS 域名依次解析。
 */
export class StorageService implements StorageServicing {
  /**
   * 服务层组件
   */
  private readonly apiService: ApiServicing;

  /**
   * 平台资源
   */
  private readonly clientFactory: StorageObjectClientFactory;

  /**
   * 标识生成
   */
  private readonly dateGenerator: () => Date;
  private readonly identifierGenerator: () => string;

  /**
   * 创建存储 Service。
   *
   * @param options.apiService Xmax API 请求组件。
   * @param options.clientFactory 对象存储客户端工厂（可替换，测试用）。
   * @param options.dateGenerator 时间来源（可替换，测试用）。
   * @param options.identifierGenerator 标识来源（可替换，测试用）。
   */
  constructor(options: StorageServiceOptions) {
    this.apiService = options.apiService;
    this.clientFactory = options.clientFactory ?? StorageService.cosClientFactory;
    this.dateGenerator = options.dateGenerator ?? (() => new Date());
    this.identifierGenerator =
      options.identifierGenerator ?? (() => crypto.randomUUID().toLowerCase());
  }

  /**
   * 上传图片并返回访问地址。
   */
  async uploadImage(options: StorageUploadOptions): Promise<StoredFile> {
    const startedAt = Date.now();
    try {
      const safeName = StorageService.validateFileName(options.fileName);
      const contentType =
        options.contentType?.trim() || StorageService.inferContentType(safeName);
      const body = StorageService.makeBody(options.data, contentType);
      if (body.size === 0) {
        throw new XmaxError(
          XmaxErrorCode.invalidConfiguration,
          "Image data cannot be empty",
        );
      }

      const temporary = await this.fetchStorageConfiguration();
      const objectKey = this.makeObjectKey(temporary.prefix, safeName);
      const client = await this.clientFactory(temporary);

      XmaxLogger.storage.info(
        () =>
          `开始上传 (Upload Started)\n` +
          `├─ ${XmaxLogger.localized("文件：", "File: ")}${safeName}\n` +
          `└─ ${XmaxLogger.localized("大小：", "Size: ")}${StorageService.formatByteCount(body.size)}`,
      );

      const uploaded = await StorageService.putObject(client, {
        Bucket: temporary.bucket,
        Region: temporary.region,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
        onProgress: options.onProgress
          ? (info) => options.onProgress?.(info.loaded, info.total)
          : undefined,
      });

      const url = StorageService.resolveObjectURL(
        uploaded.Location,
        temporary,
        objectKey,
      );
      XmaxLogger.storage.info(
        () =>
          `上传完成 (Upload Completed)\n` +
          `├─ ${XmaxLogger.localized("地址：", "URL: ")}${url}\n` +
          `└─ ${XmaxLogger.localized("耗时：", "Duration: ")}${Date.now() - startedAt}ms`,
      );
      return new StoredFile({ url, objectKey, etag: uploaded.ETag });
    } catch (error) {
      if (error instanceof XmaxError) {
        throw error;
      }
      throw new XmaxError(
        XmaxErrorCode.uploadError,
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : String(error),
      );
    }
  }

  /**
   * 获取临时存储配置；字段不完整时抛出 API 错误。
   */
  private async fetchStorageConfiguration(): Promise<TemporaryStorageConfiguration> {
    const payload = await this.apiService.get<TemporaryStoragePayload>("/cos/sts");

    const message = "Invalid storage credential payload";
    const bucket = StorageService.nonEmpty(payload.bucket);
    const region = StorageService.nonEmpty(payload.region);
    const prefix = StorageService.nonEmpty(payload.prefix);
    const accessKeyID = StorageService.nonEmpty(payload.credentials?.accessKeyId);
    const secretAccessKey = StorageService.nonEmpty(payload.credentials?.secretAccessKey);
    const sessionToken = StorageService.nonEmpty(payload.credentials?.sessionToken);
    if (!bucket || !region || !prefix || !accessKeyID || !secretAccessKey || !sessionToken) {
      throw new XmaxError(XmaxErrorCode.apiError, message);
    }

    return {
      bucket,
      region,
      endpoint: StorageService.nonEmpty(payload.endpoint),
      prefix,
      credentials: { accessKeyID, secretAccessKey, sessionToken },
    };
  }

  /**
   * 生成对象键：`${prefix}${毫秒时间戳}_${标识}_${文件名}`。
   */
  private makeObjectKey(prefix: string, fileName: string): string {
    const milliseconds = Math.round(this.dateGenerator().getTime());
    return `${prefix}${milliseconds}_${this.identifierGenerator()}_${fileName}`;
  }

  /**
   * 生产环境 COS 客户端工厂：动态加载 cos-js-sdk-v5 并按临时凭证创建客户端。
   */
  private static async cosClientFactory(
    configuration: TemporaryStorageConfiguration,
  ): Promise<StorageObjectClient> {
    const module = await import("cos-js-sdk-v5");
    const COS = module.default;
    return new COS({
      SecretId: configuration.credentials.accessKeyID,
      SecretKey: configuration.credentials.secretAccessKey,
      SecurityToken: configuration.credentials.sessionToken,
    }) as unknown as StorageObjectClient;
  }

  /**
   * 调用对象存储上传并包装为 Promise。
   */
  private static putObject(
    client: StorageObjectClient,
    params: Parameters<StorageObjectClient["putObject"]>[0],
  ): Promise<{ Location?: string; ETag?: string }> {
    return new Promise((resolve, reject) => {
      client.putObject(params, (error, data) => {
        if (error) {
          reject(
            new XmaxError(
              XmaxErrorCode.uploadError,
              error.message?.trim() || "Storage upload failed",
            ),
          );
          return;
        }
        resolve(data ?? {});
      });
    });
  }

  /**
   * 解析对象访问地址：优先使用上传返回的 `Location`（补全协议），
   * 其次拼接自定义 endpoint，最后回退到默认 COS 域名。
   */
  private static resolveObjectURL(
    location: string | undefined,
    configuration: TemporaryStorageConfiguration,
    objectKey: string,
  ): string {
    const candidate = location?.trim() ?? "";
    if (candidate.startsWith("//")) {
      return `https:${candidate}`;
    }
    if (/^https?:\/\//i.test(candidate)) {
      return candidate;
    }

    const endpoint = configuration.endpoint?.trim();
    if (endpoint) {
      const normalized = /^https?:\/\//i.test(endpoint)
        ? endpoint
        : `https://${endpoint}`;
      return `${normalized.replace(/\/+$/, "")}/${objectKey}`;
    }

    return `https://${configuration.bucket}.cos.${configuration.region}.myqcloud.com/${objectKey}`;
  }

  /**
   * 统一构造上传体。
   */
  private static makeBody(
    data: StorageUploadOptions["data"],
    contentType: string,
  ): Blob {
    if (data instanceof Blob) {
      return data;
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return new Blob([bytes as unknown as BlobPart], { type: contentType });
  }

  /**
   * 校验文件名非空且不包含路径分隔符。
   */
  private static validateFileName(fileName: string): string {
    const safeName = fileName.trim();
    if (!safeName || safeName.includes("/") || safeName.includes("\\")) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Invalid file name for storage upload",
      );
    }
    return safeName;
  }

  /**
   * 按文件名后缀推断内容类型。
   */
  private static inferContentType(fileName: string): string {
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    return CONTENT_TYPES[extension] ?? "application/octet-stream";
  }

  /**
   * 格式化字节数用于日志输出。
   */
  private static formatByteCount(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  /**
   * 归一化可选字符串：去除首尾空白后为空时返回 `undefined`。
   */
  private static nonEmpty(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }
}
