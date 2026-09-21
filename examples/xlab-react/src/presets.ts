/**
 * 内置示例预设（参考图资源托管在平台静态资源域）。
 */

export interface StylePreset {
  /** 预设名称。 */
  name: string;

  /** 列表缩略图 URL。 */
  thumbnail: string;

  /** 上传给生成服务的参考图 URL。 */
  reference: string;
}

function makePreset(
  group: string,
  version: string,
  name: string,
  imageFile: string,
  referenceFile: string,
): StylePreset {
  const base = `https://platform.xmaxai.com/images/source/${group}`;
  return {
    name,
    thumbnail: `${base}/${imageFile}?presetVersion=${version}`,
    reference: `${base}/${referenceFile}?presetVersion=${version}`,
  };
}

/** 风格迁移预设。 */
const STYLE_PRESETS: readonly StylePreset[] = [
  makePreset("vibex", "20260911", "American Cartoon", "vibex_image1.jpg", "vibex_real_image1.png"),
  makePreset("vibex", "20260911", "3D Cartoon", "vibex_image2.jpg", "vibex_real_image2.png"),
  makePreset("vibex", "20260911", "School Anime", "vibex_image3.jpg", "vibex_real_image3.png"),
  makePreset("vibex", "20260911", "Urban Anime", "vibex_image4.jpg", "vibex_real_image4.png"),
  makePreset("vibex", "20260911", "Japanese Anime", "vibex_image5.jpg", "vibex_real_image5.png"),
  makePreset("vibex", "20260911", "Realistic Animals", "vibex_image9.png", "vibex_real_image9.png"),
  makePreset("vibex", "20260911", "Designer Toy", "vibex_image10.png", "vibex_real_image10.png"),
  makePreset("vibex", "20260911", "Anthropomorphic", "vibex_image15.jpeg", "vibex_real_image15.png"),
  makePreset("vibex", "20260911", "Surrealism", "vibex_image17.png", "vibex_real_image17.png"),
  makePreset("vibex", "20260911", "Disney Style", "vibex_image18.png", "vibex_real_image18.png"),
  makePreset("vibex", "20260911", "Cel Shading", "vibex_image19.png", "vibex_real_image19.png"),
  makePreset("vibex", "20260911", "Japanese Animation", "vibex_image21.png", "vibex_real_image21.png"),
];

/** 换装预设。 */
const OUTFIT_PRESETS: readonly StylePreset[] = [
  makePreset("clothx", "20260909", "Gilded Goddess", "clothx_image1.png", "clothx_real_image1.jpg"),
  makePreset("clothx", "20260909", "Monochrome Vanguard", "clothx_image2.png", "clothx_real_image2.png"),
  makePreset("clothx", "20260909", "Silver Fantasy Robe", "clothx_image3.png", "clothx_real_image3.jpeg"),
  makePreset("clothx", "20260909", "Navy Sailor Outfit", "clothx_image4.png", "clothx_real_image4.png"),
  makePreset("clothx", "20260909", "Long Coat Set", "clothx_image5.png", "clothx_real_image5.png"),
  makePreset("clothx", "20260909", "Pink Academy", "clothx_image6.png", "clothx_real_image6.jpeg"),
  makePreset("clothx", "20260909", "Bronze Warrior Armor", "clothx_image7.png", "clothx_real_image7.png"),
  makePreset("clothx", "20260909", "Vintage Brown", "clothx_image8.png", "clothx_real_image8.png"),
  makePreset("clothx", "20260909", "Black-Collar Academy", "clothx_image9.png", "clothx_real_image9.jpeg"),
  makePreset("clothx", "20260909", "Blue Plaid Academy", "clothx_image10.png", "clothx_real_image10.jpeg"),
  makePreset("clothx", "20260909", "Black Pinafore", "clothx_image11.png", "clothx_real_image11.jpeg"),
  makePreset("clothx", "20260909", "Coffee Cardigan", "clothx_image12.png", "clothx_real_image12.jpeg"),
  makePreset("clothx", "20260909", "Lilac Slip Dress", "clothx_image13.png", "clothx_real_image13.jpeg"),
  makePreset("clothx", "20260909", "Magenta Techwear", "clothx_image14.png", "clothx_real_image14.png"),
  makePreset("clothx", "20260909", "Luxury Suit", "clothx_image15.png", "clothx_real_image15.png"),
  makePreset("clothx", "20260909", "Navy Officewear", "clothx_image16.png", "clothx_real_image16.png"),
  makePreset("clothx", "20260909", "Burgundy Stripes", "clothx_image17.png", "clothx_real_image17.jpeg"),
  makePreset("clothx", "20260909", "Light Blue Sportswear", "clothx_image18.png", "clothx_real_image18.png"),
  makePreset("clothx", "20260909", "Silver Casualwear", "clothx_image19.png", "clothx_real_image19.png"),
  makePreset("clothx", "20260909", "British Brown Plaid", "clothx_image20.png", "clothx_real_image20.png"),
  makePreset("clothx", "20260909", "Blue and White Retro", "clothx_image21.png", "clothx_real_image21.jpeg"),
  makePreset("clothx", "20260909", "All-Denim Outfit", "clothx_image22.png", "clothx_real_image22.png"),
  makePreset("clothx", "20260909", "Gray Eveningwear", "clothx_image23.png", "clothx_real_image23.png"),
  makePreset("clothx", "20260909", "Black Classical Robe", "clothx_image24.png", "clothx_real_image24.png"),
];

/** 示例预设列表：风格迁移在前，换装在后。 */
export const EXAMPLE_PRESETS: readonly StylePreset[] = [
  ...STYLE_PRESETS,
  ...OUTFIT_PRESETS,
];
