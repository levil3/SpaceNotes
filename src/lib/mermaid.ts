import DOMPurify, {
  type Config as DomPurifyConfig,
} from "dompurify";
import type { MermaidConfig } from "mermaid";

const MERMAID_LANGUAGES = new Set(["mermaid", "mmd"]);
const PREVIEW_ATTRIBUTE = "data-mermaid-preview-id";
const PREVIEW_CLASS = "mermaid-preview";
const MAX_ERROR_LENGTH = 800;

type MermaidModule = typeof import("mermaid").default;

const previewSources = new Map<string, string>();
let nextPreviewId = 0;
let mermaidLoader: Promise<MermaidModule> | null = null;
let renderQueue: Promise<void> = Promise.resolve();
let pruneTimer: number | null = null;

const PURIFY_CONFIG = {
  ADD_TAGS: ["foreignObject"],
  ADD_ATTR: ["xmlns", "xmlns:xlink"],
  HTML_INTEGRATION_POINTS: { foreignobject: true },
} satisfies DomPurifyConfig;

export function isMermaidLanguage(language: string) {
  return MERMAID_LANGUAGES.has(language.trim().toLowerCase());
}

function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid")
      .then((module) => module.default)
      .catch((error) => {
        mermaidLoader = null;
        throw error;
      });
  }
  return mermaidLoader;
}

function mermaidConfig(): MermaidConfig {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "dark" : "default";
  const fontFamily = getComputedStyle(document.body).fontFamily.trim();

  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme,
    ...(fontFamily ? { fontFamily } : {}),
    flowchart: { htmlLabels: true, useMaxWidth: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
  };
}

function findPreview(id: string) {
  return document.querySelector<HTMLElement>(
    `.${PREVIEW_CLASS}[${PREVIEW_ATTRIBUTE}="${id}"]`,
  );
}

function pruneDetachedPreviews() {
  pruneTimer = null;
  previewSources.forEach((_source, id) => {
    if (!findPreview(id)) {
      previewSources.delete(id);
    }
  });
}

function schedulePrune() {
  if (pruneTimer !== null) {
    return;
  }
  pruneTimer = window.setTimeout(pruneDetachedPreviews, 0);
}

function errorDetail(error: unknown) {
  const raw =
    error instanceof Error ? error.message : String(error ?? "");
  const detail =
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "请检查 Mermaid 图表语法。";
  return detail.slice(0, MAX_ERROR_LENGTH);
}

function showRenderError(container: HTMLElement, error: unknown) {
  const wrapper = document.createElement("div");
  wrapper.className = "mermaid-preview-error";
  const title = document.createElement("strong");
  title.textContent = "Mermaid 图表渲染失败";
  const detail = document.createElement("span");
  detail.textContent = errorDetail(error);
  wrapper.append(title, detail);
  container.replaceChildren(wrapper);
  container.removeAttribute("aria-busy");
  container.dataset.mermaidRendered = "error";
}

async function renderMermaidInto(id: string, source: string) {
  // Let Vue replace the previous preview before deciding whether this render
  // still belongs to a live code block.
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  let container = findPreview(id);
  if (!container?.isConnected) {
    previewSources.delete(id);
    return;
  }

  try {
    const mermaid = await loadMermaid();
    mermaid.initialize(mermaidConfig());
    const { svg, bindFunctions } = await mermaid.render(
      `spacenotes-mermaid-${id}`,
      source,
    );

    // The note or code block may have changed while Mermaid was rendering.
    container = findPreview(id);
    if (!container?.isConnected) {
      previewSources.delete(id);
      return;
    }

    container.innerHTML = DOMPurify.sanitize(svg, PURIFY_CONFIG);
    container.removeAttribute("aria-busy");
    container.dataset.mermaidRendered = "true";
    bindFunctions?.(container);
  } catch (error) {
    container = findPreview(id);
    if (container?.isConnected) {
      showRenderError(container, error);
    } else {
      previewSources.delete(id);
    }
  }
}

function enqueueRender(id: string, source: string) {
  renderQueue = renderQueue
    .then(() => renderMermaidInto(id, source))
    .catch((error) => {
      console.error("Failed to render Mermaid preview", error);
    });
}

/**
 * Reserves a stable preview slot immediately, then fills it asynchronously.
 * Returning a slot instead of the final SVG prevents a slow older render from
 * replacing a newer edit when the user types quickly.
 */
export function renderMermaidPreview(source: string) {
  if (!source.trim()) {
    return null;
  }

  const id = String(++nextPreviewId);
  previewSources.set(id, source);
  enqueueRender(id, source);
  schedulePrune();

  return (
    `<div class="${PREVIEW_CLASS}" ${PREVIEW_ATTRIBUTE}="${id}" aria-busy="true">` +
    `<span class="mermaid-preview-loading">正在渲染图表…</span></div>`
  );
}

/** Re-renders mounted diagrams so their colors follow the active app theme. */
export function refreshMermaidPreviews() {
  document
    .querySelectorAll<HTMLElement>(`.${PREVIEW_CLASS}[${PREVIEW_ATTRIBUTE}]`)
    .forEach((container) => {
      const id = container.dataset.mermaidPreviewId;
      const source = id ? previewSources.get(id) : undefined;
      if (!id || source === undefined) {
        return;
      }
      container.setAttribute("aria-busy", "true");
      enqueueRender(id, source);
    });
}

export function clearMermaidPreviews() {
  previewSources.clear();
  if (pruneTimer !== null) {
    window.clearTimeout(pruneTimer);
    pruneTimer = null;
  }
}
