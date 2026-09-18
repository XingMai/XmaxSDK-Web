export interface RealtimeContextInit {
  /** 实时生成使用的文本条件。 */
  prompt: string;

  /** 已上传参考图片的可选远端路径。 */
  referencePath?: string;
}

/**
 * 单次实时生成任务的文本和参考资源上下文。
 */
export class RealtimeContext {
  /** 实时生成使用的文本条件。 */
  readonly prompt: string;

  /** 已上传参考图片的可选远端路径。 */
  readonly referencePath?: string;

  /** 创建实时生成条件并规范化文本和参考路径。 */
  constructor(init: RealtimeContextInit) {
    this.prompt = init.prompt.trim();
    const normalizedReferencePath = init.referencePath?.trim();
    this.referencePath =
      normalizedReferencePath && normalizedReferencePath.length > 0
        ? normalizedReferencePath
        : undefined;
  }
}
