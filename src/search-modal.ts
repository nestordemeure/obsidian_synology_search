import { App, Editor, SuggestModal } from "obsidian";
import type { SynologyApi, FileResult } from "./synology-api";
import type { SynologyLinkSettings } from "./settings";

export class SynologySearchModal extends SuggestModal<FileResult> {
  private api: SynologyApi;
  private settings: SynologyLinkSettings;
  private editor: Editor;
  private selectedText: string;
  private results: FileResult[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(
    app: App,
    api: SynologyApi,
    settings: SynologyLinkSettings,
    editor: Editor,
    selectedText: string
  ) {
    super(app);
    this.api = api;
    this.settings = settings;
    this.editor = editor;
    this.selectedText = selectedText;

    this.setPlaceholder("Search for files on your Synology NAS...");

    // Pre-populate the input with selected text
    if (selectedText) {
      this.inputEl.value = selectedText;
      // Trigger a search immediately with the pre-populated text
      this.inputEl.dispatchEvent(new Event("input"));
    }
  }

  getSuggestions(query: string): FileResult[] | Promise<FileResult[]> {
    if (!query || query.length < 2) {
      this.results = [];
      return [];
    }

    // Show "Searching..." while debouncing / fetching
    this.emptyStateText = "Searching...";
    const emptyEl = this.resultContainerEl.querySelector(".suggestion-empty");
    if (emptyEl) {
      emptyEl.textContent = "Searching...";
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    return new Promise<FileResult[]>((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        // Cancel any in-progress search
        if (this.abortController) {
          this.abortController.abort();
        }
        this.abortController = new AbortController();

        const folders = this.settings.searchFolders
          .split(",")
          .map((f) => f.trim())
          .filter((f) => f.length > 0);

        const extensions = this.settings.fileExtensions
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e.length > 0);

        if (folders.length === 0) {
          this.emptyStateText = "No search folders configured";
          resolve([]);
          return;
        }

        try {
          const results = await this.api.searchFiles(
            query,
            folders,
            extensions,
            this.abortController.signal
          );
          this.results = results;
          if (results.length === 0) {
            this.emptyStateText = "No files found";
          }
          resolve(results);
        } catch {
          // Return previous results on error (search was likely cancelled)
          resolve(this.results);
        }
      }, 300);
    });
  }

  renderSuggestion(item: FileResult, el: HTMLElement): void {
    const nameEl = el.createEl("div", { cls: "synology-result-name" });
    nameEl.createEl("span", {
      text: item.name,
      cls: "synology-result-filename",
    });

    const parentPath = item.path.substring(
      0,
      item.path.length - item.name.length - 1
    );

    const detailEl = el.createEl("div", { cls: "synology-result-detail" });
    detailEl.createEl("span", {
      text: parentPath,
      cls: "synology-result-path",
    });
    detailEl.createEl("span", {
      text: ` — ${formatFileSize(item.size)}`,
      cls: "synology-result-size",
    });
  }

  onChooseSuggestion(item: FileResult): void {
    const displayText =
      this.selectedText || item.name.replace(/\.[^/.]+$/, "");
    const encodedPath = encodeURIComponent(item.path);
    const link = `[${displayText}](obsidian://synology-open?path=${encodedPath})`;

    if (this.selectedText) {
      this.editor.replaceSelection(link);
    } else {
      const cursor = this.editor.getCursor();
      this.editor.replaceRange(link, cursor);
    }
  }

  onClose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
