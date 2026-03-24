import { Editor, MarkdownView, Menu, Plugin } from "obsidian";
import {
  SynologyLinkSettingTab,
  DEFAULT_SETTINGS,
  type SynologyLinkSettings,
} from "./settings";
import { SynologyApi } from "./synology-api";
import { SynologySearchModal } from "./search-modal";
import { SynologyLinkChild } from "./link-handler";

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

    // Register markdown post-processor for synology:// links
    this.registerMarkdownPostProcessor((el, ctx) => {
      const links = el.querySelectorAll('a[href^="synology://"]');
      links.forEach((link) => {
        const child = new SynologyLinkChild(
          link as HTMLElement,
          this.synologyApi
        );
        ctx.addChild(child);
      });
    });
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
    // Clear cached connection info when settings change
    this.synologyApi.clearCache();
  }
}
