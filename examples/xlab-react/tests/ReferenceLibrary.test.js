// From examples/xlab-react: ../../packages/xmax-sdk/node_modules/.bin/vitest run --globals tests/ReferenceLibrary.test.js
// No camera, API or COS calls.
import { File } from "node:buffer";
import { ReferenceLibrary } from "../src/ReferenceLibrary";
import { EXAMPLE_MODES } from "../src/presets";

function localFile(name = "local.png") {
  return new File(["image"], name, { type: "image/png" });
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("ReferenceLibrary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("selects the first character preset and generates exactly once without uploading on entry", async () => {
    const upload = vi.fn();
    const library = new ReferenceLibrary(upload);
    const mode = EXAMPLE_MODES.find((mode) => mode.key === "charx");
    const generate = vi.fn(async (reference) => {
      expect(library.snapshot.find((item) => item.is_selected)).toEqual(reference);
      expect(reference).toMatchObject({
        mode: "charx", name: mode.presets[0].name, prompt: mode.prompt,
        reference_path: mode.presets[0].reference, is_selected: true,
      });
    });
    await library.selectInitialReference(generate);
    expect(generate).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });

  it("resets entry to the first built-in character preset after uploads and a mode change", async () => {
    const library = new ReferenceLibrary(async () => "https://cos.example/local");
    const firstPresetID = library.snapshot[0].id;
    await library.addFile(localFile(), "local prompt", async () => {});
    library.setMode("clothx");
    await library.select(library.snapshot.find((item) => item.mode === "clothx").id, async () => {});
    const generate = vi.fn(async () => {});
    await library.selectInitialReference(generate);
    // 选中态按模式各自维护，断言角色替换模式内只有第一张预置图被选中。
    expect(library.snapshot.filter((item) => item.mode === "charx" && item.is_selected).map((item) => item.id)).toEqual([firstPresetID]);
    expect(generate).toHaveBeenCalledOnce();
    // 之后仍可正常点击该模式中的其他条目，不会每次点击都重置默认图。
    const next = library.snapshot.find((item) => item.mode === "charx" && !item.file && item.id !== firstPresetID);
    await library.select(next.id, generate);
    expect(library.snapshot.find((item) => item.mode === "charx" && item.is_selected).id).toBe(next.id);
  });

  it("remembers the selection of each mode across tab switches", async () => {
    const library = new ReferenceLibrary(async () => "https://cos.example/local");
    const apply = vi.fn(async () => {});
    const charxA = library.snapshot.find((item) => item.mode === "charx");
    const charxB = library.snapshot.find((item) => item.mode === "charx" && item.id !== charxA.id);
    const clothA = library.snapshot.find((item) => item.mode === "clothx");
    await library.select(charxA.id, apply);
    library.setMode("clothx");
    await library.select(clothA.id, apply);
    // 切回角色替换，A 的选中态恢复，且不影响虚拟试衣的记住项。
    library.setMode("charx");
    expect(library.snapshot.find((item) => item.id === charxA.id).is_selected).toBe(true);
    expect(library.snapshot.find((item) => item.id === clothA.id).is_selected).toBe(true);
    // 同模式内改选 B 后，记住项更新为 B。
    await library.select(charxB.id, apply);
    library.setMode("clothx");
    expect(library.snapshot.find((item) => item.id === clothA.id).is_selected).toBe(true);
    library.setMode("charx");
    expect(library.snapshot.find((item) => item.id === charxB.id).is_selected).toBe(true);
    expect(library.snapshot.find((item) => item.id === charxA.id).is_selected).toBe(false);
  });

  it("gives each preset its own stable identity, prompt, path and selection state", () => {
    const library = new ReferenceLibrary(vi.fn());
    expect(new Set(library.snapshot.map((item) => item.id)).size).toBe(library.snapshot.length);
    for (const item of library.snapshot) {
      expect(item.prompt).not.toBe("");
      const preset = EXAMPLE_MODES.find((mode) => mode.key === item.mode).presets.find((preset) => preset.name === item.name);
      expect(item.reference_path).toBe(preset.reference);
      expect(item.upload_status).toBe("ready");
      expect(item.is_selected).toBe(false);
    }
  });

  it("shows a local preview first, tracks loading, then selects and generates with the uploaded URL", async () => {
    const pending = deferred();
    const upload = vi.fn(() => pending.promise);
    const apply = vi.fn(async () => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const library = new ReferenceLibrary(upload);
    const file = new File(["image"], "local.png", { type: "image/png" });
    const operation = library.addFile(file, "custom prompt", apply);
    expect(library.snapshot[0]).toMatchObject({
      name: "local.png", file, thumbnail: "blob:preview", prompt: "custom prompt",
      is_selected: false, upload_status: "uploading",
    });
    expect(apply).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    upload.mock.calls[0][1](42, 100);
    expect(library.snapshot[0].upload_progress).toBe(42);
    pending.resolve("https://cos.example/local.png");
    await operation;
    expect(library.snapshot[0]).toMatchObject({
      is_selected: true, upload_status: "ready", reference_path: "https://cos.example/local.png",
    });
    expect(apply).toHaveBeenCalledWith(library.snapshot[0]);
  });

  it("applies presets directly without any upload or loading, keeping only one selected", async () => {
    const upload = vi.fn();
    const apply = vi.fn(async () => {});
    const library = new ReferenceLibrary(upload);
    const snapshots = [];
    library.subscribe((items) => snapshots.push(items));
    const [first, second] = library.snapshot;
    await library.select(first.id, apply);
    await library.select(second.id, apply);
    await library.select(first.id, apply);
    expect(upload).not.toHaveBeenCalled();
    expect(snapshots.every((items) => items.every((item) => item.upload_status === "ready"))).toBe(true);
    expect(apply.mock.calls[0][0]).toMatchObject({ prompt: first.prompt, reference_path: first.reference_path });
    expect(apply).toHaveBeenCalledTimes(3);
    expect(library.snapshot.filter((item) => item.is_selected).map((item) => item.id)).toEqual([first.id]);
  });

  it("retains a failed local preview for retry without selecting or generating", async () => {
    const upload = vi.fn().mockRejectedValueOnce(new Error("COS failed")).mockResolvedValue("https://cos.example/retry.png");
    const apply = vi.fn(async () => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry");
    const library = new ReferenceLibrary(upload);
    await expect(library.addFile(new File(["image"], "retry.png", { type: "image/png" }), "retry prompt", apply)).rejects.toThrow("COS failed");
    const item = library.snapshot[0];
    expect(item).toMatchObject({ thumbnail: "blob:retry", upload_status: "error", is_selected: false });
    expect(apply).not.toHaveBeenCalled();
    await library.select(item.id, apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(library.snapshot[0].upload_status).toBe("ready");
  });

  it("applies only the latest clicked item when uploads finish out of order", async () => {
    const firstUpload = deferred(), secondUpload = deferred();
    const upload = vi.fn().mockReturnValueOnce(firstUpload.promise).mockReturnValueOnce(secondUpload.promise);
    const apply = vi.fn(async () => {});
    const library = new ReferenceLibrary(upload);
    const firstSelect = library.addFile(localFile("first.png"), "first", apply);
    const secondSelect = library.addFile(localFile("second.png"), "second", apply);
    const second = library.snapshot[0];
    secondUpload.resolve("https://cos.example/second");
    await secondSelect;
    firstUpload.resolve("https://cos.example/first");
    await firstSelect;
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0].id).toBe(second.id);
  });

  it("deduplicates repeated clicks while an upload is in flight", async () => {
    const pending = deferred();
    const upload = vi.fn(() => pending.promise);
    const apply = vi.fn(async () => {});
    const library = new ReferenceLibrary(upload);
    const first = library.addFile(localFile(), "prompt", apply);
    const id = library.snapshot[0].id;
    const second = library.select(id, apply);
    pending.resolve("https://cos.example/result");
    await Promise.all([first, second]);
    expect(upload).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
  });

  it.each(["mode", "clear", "dispose"])("does not auto-generate after %s invalidates an upload", async (action) => {
    const pending = deferred();
    const apply = vi.fn(async () => {});
    const library = new ReferenceLibrary(() => pending.promise);
    const selection = library.addFile(localFile(), "prompt", apply);
    if (action === "mode") library.setMode("clothx");
    if (action === "clear") library.clearSelection();
    if (action === "dispose") library.dispose();
    pending.resolve("https://cos.example/late");
    await selection;
    expect(apply).not.toHaveBeenCalled();
    expect(library.snapshot.some((item) => item.is_selected)).toBe(false);
  });

  it("queues the latest selection while a generation update is still in flight", async () => {
    const generating = deferred();
    const apply = vi.fn().mockReturnValueOnce(generating.promise).mockResolvedValue(undefined);
    const library = new ReferenceLibrary(async () => "https://cos.example/image");
    const [first, second] = library.snapshot;
    const firstSelect = library.select(first.id, apply);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    const secondSelect = library.select(second.id, apply);
    expect(apply).toHaveBeenCalledOnce();
    generating.resolve();
    await Promise.all([firstSelect, secondSelect]);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1][0].id).toBe(second.id);
  });

  it("keeps preview URLs alive when deselected and releases them on unmount", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:owned");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const library = new ReferenceLibrary(async () => "https://cos.example/file");
    await library.addFile(new File(["image"], "file.png", { type: "image/png" }), "prompt", async () => {});
    library.clearSelection();
    expect(revoke).not.toHaveBeenCalled();
    library.dispose();
    expect(revoke).toHaveBeenCalledWith("blob:owned");
  });

  it("rejects empty or non-image files before inserting or uploading", async () => {
    const upload = vi.fn();
    const library = new ReferenceLibrary(upload);
    const count = library.snapshot.length;
    await expect(library.addFile(new File([], "empty.png"), "", vi.fn())).rejects.toThrow("non-empty image");
    await expect(library.addFile(new File(["text"], "text.txt", { type: "text/plain" }), "", vi.fn())).rejects.toThrow("non-empty image");
    expect(library.snapshot).toHaveLength(count);
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not surface an obsolete upload failure over a newer selection", async () => {
    const pending = deferred();
    const upload = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue("https://cos.example/new");
    const apply = vi.fn(async () => {});
    const library = new ReferenceLibrary(upload);
    const second = library.snapshot[0];
    const old = library.addFile(localFile(), "prompt", apply);
    const first = library.snapshot[0];
    await library.select(second.id, apply);
    pending.reject(new Error("obsolete failure"));
    await expect(old).resolves.toBeUndefined();
    expect(library.snapshot.find((item) => item.id === first.id).upload_status).toBe("error");
    expect(library.snapshot.find((item) => item.is_selected).id).toBe(second.id);
  });

  it("can select again after a generation request fails", async () => {
    const apply = vi.fn().mockRejectedValueOnce(new Error("generation failed")).mockResolvedValue(undefined);
    const upload = vi.fn(async () => "https://cos.example/image");
    const library = new ReferenceLibrary(upload);
    const id = library.snapshot[0].id;
    await expect(library.select(id, apply)).rejects.toThrow("generation failed");
    await library.select(id, apply);
    expect(upload).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("keeps same-name local images distinct and captures the upload mode's prompt", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const library = new ReferenceLibrary(async () => "https://cos.example/file");
    library.setMode("free");
    const file = new File(["image"], "same.png", { type: "image/png" });
    await library.addFile(file, "first prompt", async () => {});
    const firstID = library.snapshot[0].id;
    await library.addFile(file, "second prompt", async () => {});
    expect(library.snapshot[0]).toMatchObject({ mode: "free", prompt: "second prompt", is_selected: true });
    expect(library.snapshot[0].id).not.toBe(firstID);
    expect(library.snapshot[1]).toMatchObject({ id: firstID, prompt: "first prompt", is_selected: false });
  });

  it("reuses the COS path when selecting an uploaded local image again", async () => {
    const upload = vi.fn(async () => "https://cos.example/local.png");
    const apply = vi.fn(async () => {});
    const library = new ReferenceLibrary(upload);
    await library.addFile(localFile(), "local prompt", apply);
    const local = library.snapshot[0];
    await library.select(library.snapshot[1].id, apply);
    await library.select(local.id, apply);
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0][0]).toBe(local.file);
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ reference_path: "https://cos.example/local.png", prompt: "local prompt" }));
  });
});

describe("ReferenceLibrary.remove", () => {
  it("removes an uploaded image and clears its selection", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const library = new ReferenceLibrary(async () => "https://cos.example/local.png");
    await library.addFile(localFile(), "local prompt", async () => {});
    const local = library.snapshot[0];
    expect(local.is_selected).toBe(true);
    library.remove(local.id);
    expect(library.snapshot.find((item) => item.id === local.id)).toBeUndefined();
    expect(library.snapshot.some((item) => item.is_selected)).toBe(false);
  });

  it("prevents a pending application from generating after the image is removed", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const gate = deferred();
    const library = new ReferenceLibrary(() => gate.promise);
    const apply = vi.fn(async () => {});
    const pending = library.addFile(localFile(), "local prompt", apply);
    await Promise.resolve();
    library.remove(library.snapshot[0].id);
    gate.resolve("https://cos.example/local.png");
    await pending;
    expect(apply).not.toHaveBeenCalled();
    expect(library.snapshot.some((item) => item.file)).toBe(false);
  });
});

describe("ReferenceLibrary.clearOtherModes", () => {
  it("clears remembered selections of other modes but keeps the given mode's", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const library = new ReferenceLibrary(async () => "https://cos.example/local.png");
    const apply = vi.fn(async () => {});
    const charxA = library.snapshot.find((item) => item.mode === "charx");
    await library.select(charxA.id, apply);
    library.setMode("clothx");
    const clothA = library.snapshot.find((item) => item.mode === "clothx");
    await library.select(clothA.id, apply);
    library.setMode("free");
    await library.addFile(localFile(), "free prompt", apply);
    const freeId = library.snapshot[0].id;

    library.clearOtherModes("free");

    // 切回各模式，确认旧选中不会恢复，自由模式仍保留选中项。
    library.setMode("charx");
    expect(library.snapshot.find((item) => item.id === charxA.id).is_selected).toBe(false);
    library.setMode("clothx");
    expect(library.snapshot.find((item) => item.id === clothA.id).is_selected).toBe(false);
    library.setMode("free");
    expect(library.snapshot.find((item) => item.id === freeId).is_selected).toBe(true);
  });
});
