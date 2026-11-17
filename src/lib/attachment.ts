/**
 * 粘贴图片时的纯逻辑部分：判断剪贴板内容是不是图片、给附件挑扩展名、
 * 以及把 File 读成后端能接收的 base64 负载。
 *
 * 浏览器和 WKWebView 暴露图片的方式并不一致：有时在 `files` 里，
 * 有时只在 `items` 里（kind 为 file），所以两处都要看。
 */

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

const MIME_EXTENSIONS: Record<string, string> = {
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
};

export interface ClipboardImage {
  name: string;
  type: string;
  file: File;
}

export interface AttachmentPayload {
  name: string;
  data: string;
}

export function isImageMimeType(type: string | null | undefined) {
  return Boolean(type && type.toLowerCase().startsWith("image/"));
}

/**
 * 保留原始文件名里的扩展名，这样 `截图 2026-01-01.png` 不会变成 .png 之外的格式；
 * 文件名缺失时退回 MIME 类型，最后兜底 .png。
 */
export function imageExtension(name: string, type: string) {
  const fromName = name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS.has(fromName)) {
    return fromName;
  }
  return MIME_EXTENSIONS[type.toLowerCase()] || ".png";
}

export function ensureImageName(name: string, type: string) {
  const base = name.trim() || "pasted";
  const extension = imageExtension(base, type);
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}

/**
 * 从 paste/drop 的 DataTransfer 里挑出图片文件。`files` 为空时再看 `items`，
 * 因为 Chromium 与 WKWebView 对截图粘贴的暴露方式不同。
 */
export function collectClipboardImages(
  data: {
    files?: ArrayLike<File> | null;
    items?: ArrayLike<DataTransferItem> | null;
  } | null,
): ClipboardImage[] {
  if (!data) {
    return [];
  }

  const images: ClipboardImage[] = [];
  const seen = new Set<File>();
  const push = (file: File | null, fallbackName: string) => {
    if (!file || seen.has(file) || !isImageMimeType(file.type)) {
      return;
    }
    seen.add(file);
    images.push({
      name: ensureImageName(file.name || fallbackName, file.type),
      type: file.type,
      file,
    });
  };

  const files = data.files ? Array.from(data.files) : [];
  for (const file of files) {
    push(file, "pasted");
  }

  const items = data.items ? Array.from(data.items) : [];
  for (const item of items) {
    if (item.kind !== "file") {
      continue;
    }
    push(item.getAsFile(), "pasted");
  }

  return images;
}

/** 剪贴板里既没有文字也没有 HTML，才值得向宿主询问"是不是有张图"。 */
export function clipboardLooksEmpty(data: {
  getData(format: string): string;
  files?: ArrayLike<File> | null;
  items?: ArrayLike<DataTransferItem> | null;
} | null) {
  if (!data) {
    return true;
  }
  if (data.files && data.files.length > 0) {
    return false;
  }
  const items = data.items ? Array.from(data.items) : [];
  if (items.length > 0) {
    return false;
  }
  return !data.getData("text/plain") && !data.getData("text/html");
}

export function toBase64(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? "" : dataUrl.slice(comma + 1);
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("读取图片失败。")),
    );
    reader.readAsDataURL(file);
  });
}

export async function toAttachmentPayload(
  image: ClipboardImage,
): Promise<AttachmentPayload> {
  const dataUrl = await readFileAsDataUrl(image.file);
  return { name: image.name, data: toBase64(dataUrl) };
}
