import { describe, expect, it } from "vitest";
import {
  clipboardLooksEmpty,
  collectClipboardImages,
  ensureImageName,
  imageExtension,
  isImageMimeType,
  toBase64,
} from "./attachment";

function fakeFile(name: string, type: string) {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("clipboard image detection", () => {
  it("accepts every image MIME type the vault can serve", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
      "image/bmp",
      "image/svg+xml",
    ]) {
      expect(isImageMimeType(type)).toBe(true);
    }
    expect(isImageMimeType("text/plain")).toBe(false);
    expect(isImageMimeType("")).toBe(false);
    expect(isImageMimeType(null)).toBe(false);
  });

  it("reads images from files", () => {
    const png = fakeFile("shot.png", "image/png");
    const images = collectClipboardImages({ files: [png] });

    expect(images).toHaveLength(1);
    expect(images[0].name).toBe("shot.png");
    expect(images[0].file).toBe(png);
  });

  it("reads images that only appear in items, which is how screenshots arrive", () => {
    const png = fakeFile("image.png", "image/png");
    const images = collectClipboardImages({
      files: [],
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => png },
      ] as unknown as DataTransferItem[],
    });

    expect(images.map((image) => image.name)).toEqual(["image.png"]);
  });

  it("does not return the same file twice when it is in files and items", () => {
    const png = fakeFile("shot.png", "image/png");
    const images = collectClipboardImages({
      files: [png],
      items: [
        { kind: "file", getAsFile: () => png },
      ] as unknown as DataTransferItem[],
    });

    expect(images).toHaveLength(1);
  });

  it("ignores non-image clipboard entries", () => {
    const images = collectClipboardImages({
      files: [fakeFile("notes.txt", "text/plain")],
    });
    expect(images).toEqual([]);
  });

  it("survives a missing DataTransfer", () => {
    expect(collectClipboardImages(null)).toEqual([]);
  });
});

describe("attachment naming", () => {
  it("keeps the extension from the original file name", () => {
    expect(imageExtension("截图 2026.jpeg", "image/png")).toBe(".jpeg");
    expect(imageExtension("photo.PNG", "image/jpeg")).toBe(".png");
  });

  it("falls back to the MIME type when the name has no usable extension", () => {
    expect(imageExtension("clipboard", "image/webp")).toBe(".webp");
    expect(imageExtension("", "image/svg+xml")).toBe(".svg");
  });

  it("defaults to png for unknown types", () => {
    expect(imageExtension("clipboard", "application/octet-stream")).toBe(
      ".png",
    );
  });

  it("appends the extension only when the name lacks it", () => {
    expect(ensureImageName("shot.png", "image/png")).toBe("shot.png");
    expect(ensureImageName("shot", "image/png")).toBe("shot.png");
    expect(ensureImageName("", "image/gif")).toBe("pasted.gif");
  });
});

describe("clipboard emptiness", () => {
  it("treats text as non-empty so normal paste keeps working", () => {
    expect(
      clipboardLooksEmpty({
        getData: (format) => (format === "text/plain" ? "hello" : ""),
      }),
    ).toBe(false);
  });

  it("treats html-only content as non-empty", () => {
    expect(
      clipboardLooksEmpty({
        getData: (format) => (format === "text/html" ? "<b>x</b>" : ""),
      }),
    ).toBe(false);
  });

  it("reports a screenshot clipboard as empty", () => {
    expect(
      clipboardLooksEmpty({
        getData: () => "",
        files: [],
        items: [],
      }),
    ).toBe(true);
  });

  it("never reports a clipboard that carries files as empty", () => {
    expect(
      clipboardLooksEmpty({
        getData: () => "",
        files: [fakeFile("a.png", "image/png")],
      }),
    ).toBe(false);
  });
});

describe("data URL conversion", () => {
  it("strips the data URL prefix", () => {
    expect(toBase64("data:image/png;base64,QUJD")).toBe("QUJD");
  });

  it("returns an empty string when there is no payload", () => {
    expect(toBase64("not-a-data-url")).toBe("");
  });
});
