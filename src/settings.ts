import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type SynologyLinkPlugin from "./main";

export interface SynologyLinkSettings {
  connectionType: "quickconnect" | "direct";
  quickConnectId: string;
  directUrl: string;
  username: string;
  password: string;
  searchFolders: string;
  fileExtensions: string;
}

export const DEFAULT_SETTINGS: SynologyLinkSettings = {
  connectionType: "quickconnect",
  quickConnectId: "",
  directUrl: "",
  username: "",
  password: "",
  searchFolders: "/volume1/Books",
  fileExtensions: "",
};

export class SynologyLinkSettingTab extends PluginSettingTab {
  plugin: SynologyLinkPlugin;

  constructor(app: App, plugin: SynologyLinkPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Connection type")
      .setDesc("How to connect to your Synology NAS")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("quickconnect", "QuickConnect ID")
          .addOption("direct", "Direct URL")
          .setValue(this.plugin.settings.connectionType)
          .onChange(async (value: string) => {
            this.plugin.settings.connectionType = value as
              | "quickconnect"
              | "direct";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.connectionType === "quickconnect") {
      new Setting(containerEl)
        .setName("QuickConnect ID")
        .setDesc("Your Synology QuickConnect ID (e.g., mynas)")
        .addText((text) =>
          text
            .setPlaceholder("mynas")
            .setValue(this.plugin.settings.quickConnectId)
            .onChange(async (value) => {
              this.plugin.settings.quickConnectId = value;
              await this.plugin.saveSettings();
            })
        );
    } else {
      new Setting(containerEl)
        .setName("Direct URL")
        .setDesc(
          "Direct URL to your NAS (e.g., https://192.168.1.50:5001)"
        )
        .addText((text) =>
          text
            .setPlaceholder("https://192.168.1.50:5001")
            .setValue(this.plugin.settings.directUrl)
            .onChange(async (value) => {
              this.plugin.settings.directUrl = value;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Username")
      .setDesc("DSM login username")
      .addText((text) =>
        text
          .setPlaceholder("admin")
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            this.plugin.settings.username = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Password")
      .setDesc(
        "DSM login password. Warning: stored unencrypted in Obsidian's plugin data."
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("password")
          .setValue(this.plugin.settings.password)
          .onChange(async (value) => {
            this.plugin.settings.password = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Search folders")
      .setDesc(
        "Comma-separated NAS folder paths to search (e.g., /volume1/Books,/volume1/Papers)"
      )
      .addText((text) =>
        text
          .setPlaceholder("/volume1/Books")
          .setValue(this.plugin.settings.searchFolders)
          .onChange(async (value) => {
            this.plugin.settings.searchFolders = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("File extensions")
      .setDesc(
        "Comma-separated extensions to filter (e.g., pdf,epub,djvu,mobi). Leave empty for all files."
      )
      .addText((text) =>
        text
          .setPlaceholder("pdf,epub,djvu,mobi")
          .setValue(this.plugin.settings.fileExtensions)
          .onChange(async (value) => {
            this.plugin.settings.fileExtensions = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Test authentication with your Synology NAS")
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            const success = await this.plugin.synologyApi.testConnection();
            if (success) {
              new Notice("Synology connection successful!");
            } else {
              new Notice(
                "Connection failed. Check your settings."
              );
            }
          } catch (e) {
            new Notice(
              `Connection failed: ${e instanceof Error ? e.message : "Unknown error"}`
            );
          } finally {
            button.setButtonText("Test");
            button.setDisabled(false);
          }
        })
      );
  }
}
