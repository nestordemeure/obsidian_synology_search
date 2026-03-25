import { Editor, MarkdownView, Menu, Notice, Plugin } from "obsidian";
import {
  SynologyLinkSettingTab,
  DEFAULT_SETTINGS,
  type SynologyLinkSettings,
} from "./settings";
import { SynologyApi } from "./synology-api";
import { SynologySearchModal } from "./search-modal";
import { SynologyLinkChild, buildLivePreviewExtension, openSynologyLink } from "./link-handler";

export default class SynologyLinkPlugin extends Plugin {
  settings: SynologyLinkSettings = DEFAULT_SETTINGS;
  synologyApi: SynologyApi = new SynologyApi(() => this.settings);

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new SynologyLinkSettingTab(this.app, this));

    // Register command: "Synology: Insert file link"
    this.addCommand({
      id: "insert-synology-link",
      name: "Insert file link",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.openSearchModal(editor);
      },
    });

    // Register editor context menu item
    this.registerEvent(
      this.app.workspace.on(
        "editor-menu",
        (menu: Menu, editor: Editor) => {
          menu.addItem((item) => {
            item
              .setTitle("Add Synology link")
              .setIcon("hard-drive")
              .setSection("action")
              .onClick(() => {
                this.openSearchModal(editor);
              });
          });
        }
      )
    );

    // Global click handler: intercepts obsidian://synology-open links anywhere
    // in the DOM (properties panel, backlinks, etc.) before Obsidian's native
    // URI handler tries to route them externally.
    this.registerDomEvent(document, "click", (evt: MouseEvent) => {
      const target = evt.target as HTMLElement;
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("obsidian://synology-open")) return;

      evt.preventDefault();
      evt.stopPropagation();

      const match = href.match(/[?&]path=([^&]+)/);
      if (match) {
        const filePath = decodeURIComponent(match[1]);
        openSynologyLink(this.synologyApi, () => this.settings, filePath);
      }
    }, true); // capture phase to fire before Obsidian's handler

    // Protocol handler for obsidian://synology-open from external apps
    this.registerObsidianProtocolHandler("synology-open", (params) => {
      const filePath = params.path;
      if (!filePath) {
        new Notice("Synology link missing path parameter.");
        return;
      }
      openSynologyLink(this.synologyApi, () => this.settings, filePath);
    });

    // Reading View: post-processor for synology:// and obsidian://synology-open links
    this.registerMarkdownPostProcessor((el, ctx) => {
      const links = el.querySelectorAll(
        'a[href^="synology://"], a[href^="obsidian://synology-open"]'
      );
      links.forEach((link) => {
        const child = new SynologyLinkChild(
          link as HTMLElement,
          this.synologyApi,
          () => this.settings
        );
        ctx.addChild(child);
      });
    });

    // Live Preview: editor extension for synology:// links
    this.registerEditorExtension(
      buildLivePreviewExtension(this.synologyApi, () => this.settings)
    );
  }

  private openSearchModal(editor: Editor): void {
    const selectedText = editor.getSelection();
    const modal = new SynologySearchModal(
      this.app,
      this.synologyApi,
      this.settings,
      editor,
      selectedText
    );
    modal.open();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.synologyApi.clearCache();
  }
}
