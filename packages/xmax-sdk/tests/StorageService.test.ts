import { describe, expect, it } from "vitest";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { ApiMethod, type ApiServicing } from "../src/Service/Network/ApiServicing";
import {
  StorageService,
  type StorageObjectClient,
} from "../src/Service/Storage/StorageService";

/** API 桩：按方法返回队列中的响应。 */
class ApiServicingStub implements ApiServicing {
  requests: { method: ApiMethod; path: string; body?: unknown }[] = [];
  responses: Array<unknown | Error> = [];

  request<T>(method: ApiMethod, path: string, body?: unknown): Promise<T> {
    this.requests.push({ method, path, body });
    const next = this.responses.length > 1 ? this.responses.shift() : this.responses[0];
    if (next === undefined) {
      return Promise.reject(
        new XmaxError(XmaxErrorCode.apiError, `No stubbed response for ${method} ${path}`),
      );
    }
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(next as T);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(ApiMethod.get, path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(ApiMethod.post, path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(ApiMethod.put, path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(ApiMethod.delete, path);
  }
}

const stsPayload = {
  bucket: "xmax-1300000000",
  region: "ap-guangzhou",
  prefix: "uploads/",
  credentials: {
    accessKeyId: "AKID-test",
    secretAccessKey: "secret-test",
    sessionToken: "token-test",
  },
};

/** 对象存储客户端桩：记录上传参数并返回可控结果。 */
class StorageObjectClientStub implements StorageObjectClient {
  putCalls: Array<{
    Bucket: string;
    Region: string;
    Key: string;
    Body: Blob;
    ContentType: string;
  }> = [];
  result: { Location?: string; ETag?: string } = {
    Location: "//xmax-1300000000.cos.ap-guangzhou.myqcloud.com/uploads/key.png",
    ETag: "etag-1",
  };
  failWith?: { message?: string };

  putObject(
    params: Parameters<StorageObjectClient["putObject"]>[0],
    callback: Parameters<StorageObjectClient["putObject"]>[1],
  ): void {
    this.putCalls.push(params);
    params.onProgress?.({ loaded: 5, total: 10 });
    if (this.failWith) {
      callback(this.failWith);
      return;
    }
    callback(null, this.result);
  }
}

function makeService(options?: { payload?: unknown }) {
  const api = new ApiServicingStub();
  api.responses.push(options?.payload ?? stsPayload);
  const client = new StorageObjectClientStub();
  const service = new StorageService({
    apiService: api,
    clientFactory: async () => client,
    dateGenerator: () => new Date(1_700_000_000_000),
    identifierGenerator: () => "abc123",
  });
  return { api, client, service };
}

const sampleData = new Uint8Array([1, 2, 3, 4]);

describe("StorageService", () => {
  it("上传图片：获取临时凭证后直传并返回访问地址", async () => {
    const { api, client, service } = makeService();
    const progress: Array<[number, number]> = [];

    const stored = await service.uploadImage({
      data: sampleData,
      fileName: "photo.png",
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });

    expect(api.requests).toEqual([
      { method: ApiMethod.get, path: "/cos/sts", body: undefined },
    ]);
    expect(client.putCalls).toHaveLength(1);
    const call = client.putCalls[0]!;
    expect(call.Bucket).toBe("xmax-1300000000");
    expect(call.Region).toBe("ap-guangzhou");
    expect(call.Key).toBe("uploads/1700000000000_abc123_photo.png");
    expect(call.ContentType).toBe("image/png");
    expect(call.Body.size).toBe(4);
    // Location 以 // 开头时补全 https 协议。
    expect(stored.url).toBe(
      "https://xmax-1300000000.cos.ap-guangzhou.myqcloud.com/uploads/key.png",
    );
    expect(stored.objectKey).toBe("uploads/1700000000000_abc123_photo.png");
    expect(stored.etag).toBe("etag-1");
    expect(progress).toEqual([[5, 10]]);
  });

  it("未返回 Location 时按默认 COS 域名拼接访问地址", async () => {
    const { client, service } = makeService();
    client.result = {};

    const stored = await service.uploadImage({
      data: sampleData,
      fileName: "photo.jpg",
    });

    expect(stored.url).toBe(
      "https://xmax-1300000000.cos.ap-guangzhou.myqcloud.com/uploads/1700000000000_abc123_photo.jpg",
    );
  });

  it("凭证响应带自定义 endpoint 时按 endpoint 拼接访问地址", async () => {
    const { client, service } = makeService({
      payload: { ...stsPayload, endpoint: "https://cdn.example.com/base/" },
    });
    client.result = {};

    const stored = await service.uploadImage({
      data: sampleData,
      fileName: "photo.webp",
    });

    expect(stored.url).toBe(
      "https://cdn.example.com/base/uploads/1700000000000_abc123_photo.webp",
    );
  });

  it("显式内容类型优先于文件名推断", async () => {
    const { client, service } = makeService();

    await service.uploadImage({
      data: sampleData,
      fileName: "photo.bin",
      contentType: "image/png",
    });

    expect(client.putCalls[0]!.ContentType).toBe("image/png");
  });

  it("凭证字段不完整时抛出 API 错误", async () => {
    const { service } = makeService({
      payload: { bucket: "xmax-1300000000" },
    });

    await expect(
      service.uploadImage({ data: sampleData, fileName: "photo.png" }),
    ).rejects.toMatchObject({ code: XmaxErrorCode.apiError });
  });

  it("对象存储上传失败时映射为上传错误", async () => {
    const { client, service } = makeService();
    client.failWith = { message: "cos denied" };

    await expect(
      service.uploadImage({ data: sampleData, fileName: "photo.png" }),
    ).rejects.toMatchObject({
      code: XmaxErrorCode.uploadError,
      message: "cos denied",
    });
  });

  it("文件名非法或数据为空时拒绝上传", async () => {
    const { client, service } = makeService();

    await expect(
      service.uploadImage({ data: sampleData, fileName: "a/b.png" }),
    ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    await expect(
      service.uploadImage({ data: new Uint8Array(), fileName: "photo.png" }),
    ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(client.putCalls).toHaveLength(0);
  });
});
