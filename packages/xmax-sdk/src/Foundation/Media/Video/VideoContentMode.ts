/**
 * 视频内容在渲染容器中的显示模式。
 */
export enum VideoContentMode {
  /**
   * 等比完整显示，允许容器留空。
   */
  fit = "fit",

  /**
   * 等比铺满容器，允许裁剪画面。
   */
  fill = "fill",
}
