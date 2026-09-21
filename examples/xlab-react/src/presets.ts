/**
 * 示例页的模式与内置参考图预设（资源托管在平台静态资源域）。
 */

export interface StylePreset {
  /** 预设名称。 */
  name: string;

  /** 列表缩略图 URL。 */
  thumbnail: string;

  /** 上传给生成服务的参考图 URL。 */
  reference: string;
}

export type ExampleModeKey = "charx" | "clothx" | "vibex" | "free";

export interface ExampleMode {
  /** 模式标识。 */
  key: ExampleModeKey;

  /** 页签显示名称。 */
  label: string;

  /** 非自由模式提交生成时使用的固定文本条件。 */
  prompt: string;

  /** 内置参考图预设；自由输入模式为空。 */
  presets: readonly StylePreset[];
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

/** 角色替换预设。 */
const CHARX_PRESETS: readonly StylePreset[] = [
  makePreset("charx", "20260909", "Classical Girl", "charx_image1.jpeg", "charx_real_image1.png"),
  makePreset("charx", "20260909", "Classical Boy", "charx_image2.jpeg", "charx_real_image2.png"),
  makePreset("charx", "20260909", "Modern Girl", "charx_image3.png", "charx_real_image3.png"),
  makePreset("charx", "20260909", "Modern Boy", "charx_image4.png", "charx_real_image4.png"),
  makePreset("charx", "20260909", "Blonde Girl", "charx_image5.png", "charx_real_image5.png"),
  makePreset("charx", "20260909", "Curly-Haired Boy", "charx_image6.png", "charx_real_image6.jpeg"),
  makePreset("charx", "20260909", "Anime Boy", "charx_image7.png", "charx_real_image7.png"),
  makePreset("charx", "20260909", "Anime Girl", "charx_image8.png", "charx_real_image8.png"),
  makePreset("charx", "20260909", "Alien Kitty", "charx_image9.jpeg", "charx_real_image9.png"),
  makePreset("charx", "20260909", "Bronze Figure", "charx_image10.png", "charx_real_image10.jpeg"),
  makePreset("charx", "20260909", "3D Cow", "charx_image11.png", "charx_real_image11.png"),
  makePreset("charx", "20260909", "3D Milk Frog", "charx_image12.png", "charx_real_image12.jpeg"),
  makePreset("charx", "20260909", "3D Kangaroo", "charx_image13.jpg", "charx_real_image13.jpeg"),
  makePreset("charx", "20260909", "Mecha Girl", "charx_image14.png", "charx_real_image14.png"),
  makePreset("charx", "20260909", "Mecha Warrior", "charx_image15.jpg", "charx_real_image15.png"),
  makePreset("charx", "20260909", "Special Ops", "charx_image16.jpeg", "charx_real_image16.png"),
  makePreset("charx", "20260909", "Humanoid Robot", "charx_image17.png", "charx_real_image17.jpg"),
  makePreset("charx", "20260909", "Chill Capybara", "charx_image18.jpeg", "charx_real_image18.jpg"),
  makePreset("charx", "20260909", "Gentle Panda", "charx_image19.png", "charx_real_image19.png"),
  makePreset("charx", "20260909", "Cute Hamster", "charx_image20.png", "charx_real_image20.jpg"),
  makePreset("charx", "20260909", "Illustrated Girl", "charx_image21.png", "charx_real_image21.png"),
  makePreset("charx", "20260909", "Cartoon Boy", "charx_image22.jpeg", "charx_real_image22.jpeg"),
  makePreset("charx", "20260909", "Business Milk Frog", "charx_image23.png", "charx_real_image23.png"),
  makePreset("charx", "20260909", "Corporate Cow", "charx_image24.jpeg", "charx_real_image24.jpeg"),
];

/** 虚拟试衣预设。 */
const CLOTHX_PRESETS: readonly StylePreset[] = [
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

/** 风格迁移预设。 */
const VIBEX_PRESETS: readonly StylePreset[] = [
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

/** 示例页模式列表：三个参考图模式在前，自由输入在后。 */
export const EXAMPLE_MODES: readonly ExampleMode[] = [
  {
    key: "charx",
    label: "角色替换",
    prompt: "视频中角色替换成参考图中角色",
    presets: CHARX_PRESETS,
  },
  {
    key: "clothx",
    label: "虚拟试衣",
    prompt: "视频中人物衣服替换成参考图中衣服",
    presets: CLOTHX_PRESETS,
  },
  {
    key: "vibex",
    label: "风格迁移",
    prompt: "视频风格变为参考图指定的风格",
    presets: VIBEX_PRESETS,
  },
  {
    key: "free",
    label: "自由输入",
    prompt: "",
    presets: [],
  },
];
