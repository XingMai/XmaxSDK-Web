/**
 * 内置风格预设（参考图资源托管在平台静态资源域）。
 */

export interface StylePreset {
  /** 风格名称。 */
  name: string;

  /** 列表缩略图 URL。 */
  thumbnail: string;

  /** 上传给生成服务的参考图 URL。 */
  reference: string;
}

const ASSET_BASE = "https://platform.xmaxai.com/images/source/vibex";
const PRESET_VERSION = "presetVersion=20260911";

function makePreset(
  name: string,
  imageFile: string,
  referenceFile: string,
): StylePreset {
  return {
    name,
    thumbnail: `${ASSET_BASE}/${imageFile}?${PRESET_VERSION}`,
    reference: `${ASSET_BASE}/${referenceFile}?${PRESET_VERSION}`,
  };
}

/** 实时风格迁移的内置预设列表。 */
export const STYLE_PRESETS: readonly StylePreset[] = [
  makePreset("American Cartoon", "vibex_image1.jpg", "vibex_real_image1.png"),
  makePreset("3D Cartoon", "vibex_image2.jpg", "vibex_real_image2.png"),
  makePreset("School Anime", "vibex_image3.jpg", "vibex_real_image3.png"),
  makePreset("Urban Anime", "vibex_image4.jpg", "vibex_real_image4.png"),
  makePreset("Japanese Anime", "vibex_image5.jpg", "vibex_real_image5.png"),
  makePreset("Realistic Animals", "vibex_image9.png", "vibex_real_image9.png"),
  makePreset("Designer Toy", "vibex_image10.png", "vibex_real_image10.png"),
  makePreset("Anthropomorphic", "vibex_image15.jpeg", "vibex_real_image15.png"),
  makePreset("Surrealism", "vibex_image17.png", "vibex_real_image17.png"),
  makePreset("Disney Style", "vibex_image18.png", "vibex_real_image18.png"),
  makePreset("Cel Shading", "vibex_image19.png", "vibex_real_image19.png"),
  makePreset("Japanese Animation", "vibex_image21.png", "vibex_real_image21.png"),
];
