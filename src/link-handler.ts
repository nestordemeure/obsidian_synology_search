import { MarkdownRenderChild, Notice } from "obsidian";
import type { SynologyApi } from "./synology-api";
import type { SynologyLinkSettings } from "./settings";
import { EditorView } from "@codemirror/view";

type GetSettings = () => SynologyLinkSettings;

/**
 * Reading View: post-processor replaces click behavior on <a href="synology://..."> elements.
 */
export class SynologyLinkChild extends MarkdownRenderChild {
  private api: SynologyApi;
  private getSettings: GetSettings;

  constructor(
    containerEl: HTMLElement,
    api: SynologyApi,
    getSettings: GetSettings
  ) {
    super(containerEl);
    this.api = api;
    this.getSettings = getSettings;
  }

  onload(): void {
    const link = this.containerEl as HTMLAnchorElement;
    const href = link.getAttribute("href");
    if (!href) return;

    const filePath = extractSynologyPath(href);
    if (!filePath) return;

    link.addClass("synology-link");

    this.registerDomEvent(link, "click", (evt: MouseEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      openSynologyLink(this.api, this.getSettings, filePath);
    });
  }
}

/**
 * Live Preview: EditorView extension that intercepts clicks on synology:// links.
 */
export function buildLivePreviewExtension(
  api: SynologyApi,
  getSettings: GetSettings
) {
  return EditorView.domEventHandlers({
    click: (evt: MouseEvent, view: EditorView) => {
      const target = evt.target as HTMLElement;

      const linkEl =
        target.closest(".cm-underline") ||
        target.closest(".external-link");
      if (!linkEl) return false;

      const pos = view.posAtDOM(target);
      const line = view.state.doc.lineAt(pos);

      const regex = /\[[^\]]*\]\((synology:\/\/[^)]+|obsidian:\/\/synology-open[^)]+)\)/g;
      let match;
      while ((match = regex.exec(line.text)) !== null) {
        const matchStart = line.from + match.index;
        const matchEnd = matchStart + match[0].length;

        if (pos >= matchStart && pos <= matchEnd) {
          evt.preventDefault();
          evt.stopPropagation();

          const filePath = extractSynologyPath(match[1]);
          if (filePath) {
            openSynologyLink(api, getSettings, filePath);
          }
          return true;
        }
      }

      return false;
    },
  });
}

/**
 * Extract the file path from either synology:// or obsidian://synology-open URLs.
 */
function extractSynologyPath(href: string): string | null {
  if (href.startsWith("synology://")) {
    return decodeURIComponent(href.replace(/^synology:\/\//, ""));
  }
  if (href.startsWith("obsidian://synology-open")) {
    try {
      const url = new URL(href);
      const path = url.searchParams.get("path");
      return path ? decodeURIComponent(path) : null;
    } catch {
      // Fallback: parse query string manually
      const match = href.match(/[?&]path=([^&]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    }
  }
  return null;
}

export async function openSynologyLink(
  api: SynologyApi,
  getSettings: GetSettings,
  filePath: string
): Promise<void> {
  try {
    let url: string;
    if (getSettings().openFolder) {
      url = api.getFolderUrl(filePath);
    } else {
      url = await api.getDownloadUrl(filePath);
    }
    window.open(url, "_blank");
  } catch (e) {
    new Notice(
      e instanceof Error
        ? e.message
        : "Failed to open Synology link. Check your connection settings."
    );
  }
}
