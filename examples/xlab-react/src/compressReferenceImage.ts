/** 本地参考图上传前统一编码为 JPEG（质量 0.9），保持原始分辨率。 */
export async function compressReferenceImage(file: File): Promise<File> {
  const image = new Image();
  const source = URL.createObjectURL(file);
  let canvas: HTMLCanvasElement | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to decode reference image; please choose a supported image file"));
      image.src = source;
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("Reference image has invalid dimensions");
    }
    canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to prepare reference image compression");
    // JPEG 不支持透明通道，显式铺白底，避免透明 PNG 转换后出现黑底。
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const output = await new Promise<Blob | null>((resolve) => {
      canvas!.toBlob(resolve, "image/jpeg", 0.9);
    });
    if (!output || output.size === 0 || output.type !== "image/jpeg") {
      throw new Error("Unable to compress reference image as JPEG");
    }
    const basename = file.name.replace(/\.[^.]*$/, "") || "reference";
    return new File([output], `${basename}.jpg`, { type: "image/jpeg" });
  } finally {
    image.onload = null;
    image.onerror = null;
    URL.revokeObjectURL(source);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
