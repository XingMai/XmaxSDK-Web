import { File } from "node:buffer";
import { compressReferenceImage } from "../src/compressReferenceImage";

function setup({ decodeFails = false, width = 1920, height = 1024, output = new Blob(["jpeg"], { type: "image/jpeg" }), noContext = false } = {}) {
  const context = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: "" };
  let sizeAtEncode;
  const canvas = {
    width: 0, height: 0,
    getContext: vi.fn(() => noContext ? null : context),
    toBlob: vi.fn((callback) => {
      sizeAtEncode = [canvas.width, canvas.height];
      callback(output);
    }),
  };
  vi.stubGlobal("File", File);
  vi.stubGlobal("Image", class {
    naturalWidth = width;
    naturalHeight = height;
    set src(value) {
      queueMicrotask(() => decodeFails ? this.onerror?.() : this.onload?.());
    }
  });
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:compression");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { canvas, context, revoke, sizeAtEncode: () => sizeAtEncode };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("encodes JPEG at 0.9 quality without resizing and uses a matching filename and MIME type", async () => {
  const { canvas, context, revoke, sizeAtEncode } = setup();
  const original = new File(["original PNG"], "my.reference.PNG", { type: "image/png" });
  const result = await compressReferenceImage(original);
  expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
  expect(sizeAtEncode()).toEqual([1920, 1024]);
  expect(context.fillStyle).toBe("#fff");
  expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1024);
  expect(context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(context.drawImage.mock.invocationCallOrder[0]);
  expect(result.name).toBe("my.reference.jpg");
  expect(result.type).toBe("image/jpeg");
  expect(await result.text()).toBe("jpeg");
  expect(await original.text()).toBe("original PNG");
  expect(revoke).toHaveBeenCalledWith("blob:compression");
  expect([canvas.width, canvas.height]).toEqual([0, 0]);
});

it("also re-encodes existing JPEG files at the requested quality", async () => {
  const { canvas } = setup();
  const result = await compressReferenceImage(new File(["jpeg"], "photo.jpeg", { type: "image/jpeg" }));
  expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
  expect(result.name).toBe("photo.jpg");
});

it.each([
  [{ decodeFails: true }, "Unable to decode"],
  [{ width: 0 }, "invalid dimensions"],
  [{ noContext: true }, "Unable to prepare"],
  [{ output: null }, "Unable to compress"],
  [{ output: new Blob([], { type: "image/jpeg" }) }, "Unable to compress"],
  [{ output: new Blob(["PNG fallback"], { type: "image/png" }) }, "Unable to compress"],
])("rejects conversion failures instead of uploading original data (%j)", async (options, error) => {
  const { revoke } = setup(options);
  await expect(compressReferenceImage(new File(["source"], "image.png"))).rejects.toThrow(error);
  expect(revoke).toHaveBeenCalledWith("blob:compression");
});
