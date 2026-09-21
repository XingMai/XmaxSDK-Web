import { EXAMPLE_MODES, type ExampleModeKey } from "./presets";

/** 一张参考图的完整界面与生成条件；预置图直接可用，本地文件需先上传。 */
export interface ReferenceItem {
  readonly id: string;
  readonly mode: ExampleModeKey;
  readonly name: string;
  readonly thumbnail: string;
  readonly prompt: string;
  readonly reference_path?: string;
  readonly is_selected: boolean;
  readonly upload_status: "idle" | "uploading" | "ready" | "error";
  readonly upload_progress?: number;
  readonly error?: string;
  readonly file?: File;
}

type UploadReference = (
  file: File,
  onProgress: (loaded: number, total: number) => void,
) => Promise<string>;
type ApplyReference = (item: ReferenceItem) => Promise<void>;

/** 统一管理预设与本地文件，上传结果缓存到条目，只有最新选择能触发生成。 */
export class ReferenceLibrary {
  private items: readonly ReferenceItem[] = EXAMPLE_MODES.flatMap((mode) =>
    mode.presets.map((preset) => ({
      id: `${mode.key}:${preset.name}`,
      mode: mode.key,
      name: preset.name,
      thumbnail: preset.thumbnail,
      prompt: mode.prompt,
      reference_path: preset.reference,
      is_selected: false,
      upload_status: "ready" as const,
    })),
  );
  private listener?: (items: readonly ReferenceItem[]) => void;
  private mode: ExampleModeKey = "charx";
  private intent = 0;
  private uploads = new Map<string, Promise<ReferenceItem>>();
  private previews = new Set<string>();
  private application: Promise<void> = Promise.resolve();

  constructor(private readonly upload: UploadReference) {}

  get snapshot(): readonly ReferenceItem[] { return this.items; }

  subscribe(listener: (items: readonly ReferenceItem[]) => void): () => void {
    this.listener = listener;
    listener(this.items);
    return () => { this.listener = undefined; };
  }

  private update(items: readonly ReferenceItem[]): void {
    this.items = items;
    this.listener?.(items);
  }

  private patch(id: string, changes: Partial<ReferenceItem>): ReferenceItem {
    const item = { ...this.items.find((entry) => entry.id === id)!, ...changes };
    this.update(this.items.map((entry) => entry.id === id ? item : entry));
    return item;
  }

  setMode(mode: ExampleModeKey): void {
    this.mode = mode;
    this.clearSelection();
  }

  clearSelection(): void {
    this.intent += 1;
    this.update(this.items.map((item) => ({ ...item, is_selected: false })));
  }

  /** 先插入首位展示本地预览，上传后复用预置图的选中、生成流程。 */
  async addFile(file: File, prompt: string, apply: ApplyReference): Promise<void> {
    if (!file.size || (file.type && !file.type.startsWith("image/"))) {
      throw new Error("Please choose a non-empty image file");
    }
    const thumbnail = URL.createObjectURL(file);
    this.previews.add(thumbnail);
    const item: ReferenceItem = {
      id: crypto.randomUUID(), mode: this.mode, name: file.name,
      thumbnail, file, prompt, is_selected: false, upload_status: "idle",
    };
    this.update([item, ...this.items]);
    await this.select(item.id, apply);
  }

  async select(id: string, apply: ApplyReference): Promise<void> {
    const item = this.items.find((entry) => entry.id === id);
    if (!item || item.mode !== this.mode) return;
    const intent = ++this.intent;
    let ready: ReferenceItem;
    try {
      ready = await this.ensureReady(item);
    } catch (error) {
      if (intent === this.intent) throw error;
      return;
    }
    // 页签切换、清除、停止和新选择都会使旧上传失去自动应用资格。
    const application = this.application.catch(() => {}).then(async () => {
      if (intent !== this.intent) return;
      const selected = { ...ready, is_selected: true };
      this.update(this.items.map((entry) => entry.id === id
        ? selected : { ...entry, is_selected: false }));
      await apply(selected);
    });
    this.application = application;
    await application;
  }

  private ensureReady(item: ReferenceItem): Promise<ReferenceItem> {
    if (item.reference_path) return Promise.resolve(item);
    const file = item.file;
    if (!file) return Promise.reject(new Error("Reference image has no usable path"));
    const existing = this.uploads.get(item.id);
    if (existing) return existing;
    this.patch(item.id, { upload_status: "uploading", upload_progress: 0, error: undefined });
    const upload = Promise.resolve().then(() => this.upload(file, (loaded, total) => {
      if (total > 0) {
        this.patch(item.id, { upload_progress: Math.min(100, Math.max(0, Math.round(loaded / total * 100))) });
      }
    })).then((reference_path) => {
      if (!reference_path.trim()) throw new Error("Upload returned an empty reference path");
      return this.patch(item.id, { reference_path, upload_status: "ready", upload_progress: 100 });
    }).catch((error: unknown) => {
      this.patch(item.id, {
        upload_status: "error", upload_progress: undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }).finally(() => { this.uploads.delete(item.id); });
    this.uploads.set(item.id, upload);
    return upload;
  }

  dispose(): void {
    this.intent += 1;
    this.listener = undefined;
    this.previews.forEach((preview) => URL.revokeObjectURL(preview));
    this.previews.clear();
  }
}
