import { describe, expect, it } from "vitest";
import { isMermaidLanguage, renderMermaidPreview } from "./mermaid";

describe("Mermaid preview", () => {
  it("recognizes Mermaid fences without changing source casing", () => {
    expect(isMermaidLanguage("mermaid")).toBe(true);
    expect(isMermaidLanguage(" Mermaid ")).toBe(true);
    expect(isMermaidLanguage("mmd")).toBe(true);
    expect(isMermaidLanguage("javascript")).toBe(false);
    expect(isMermaidLanguage("")).toBe(false);
  });

  it("does not reserve a preview for an empty diagram", () => {
    expect(renderMermaidPreview(" \n ")).toBeNull();
  });
});
