import { MarkdownRenderChild, Notice } from "obsidian";
import type { SynologyApi } from "./synology-api";

export class SynologyLinkChild extends MarkdownRenderChild {
  private api: SynologyApi;

  constructor(containerEl: HTMLElement, api: SynologyApi) {
    super(containerEl);
    this.api = api;
  }

  onload(): void {
    const link = this.containerEl as HTMLAnchorElement;
    const href = link.getAttribute("href");

    if (!href) return;

    // Extract path from synology:///path/to/file or synology://path/to/file
    const filePath = decodeURIComponent(
      href.replace(/^synology:\/\//, "")
    );

    link.addClass("synology-link");

    this.registerDomEvent(link, "click", async (evt: MouseEvent) => {
      evt.preventDefault();
      evt.stopPropagation();

      try {
        const downloadUrl = await this.api.getDownloadUrl(filePath);
        window.open(downloadUrl, "_blank");
      } catch (e) {
        new Notice(
          e instanceof Error
            ? e.message
            : "Failed to open Synology link. Check your connection settings."
        );
      }
    });
  }
}
