/* eslint-disable obsidianmd/ui/sentence-case, obsidianmd/commands/no-plugin-id-in-command-id */
import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, SettingsTab, type PluginSettings } from "./settings";

export default class GitHubCopilotAgentPlugin extends Plugin {
settings: PluginSettings = { ...DEFAULT_SETTINGS };

async onload(): Promise<void> {
await this.loadSettings();
this.addSettingTab(new SettingsTab(this.app, this));
this.addCommand({
id: "github-copilot-agent:open-chat",
name: "Open chat",
callback: () => new Notice("GitHub Copilot chat view is not available yet."),
});
new Notice("GitHub Copilot Agent loaded");
}

onunload(): void {}

async loadSettings(): Promise<void> {
this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<PluginSettings>);
}

async saveSettings(): Promise<void> {
await this.saveData(this.settings);
}
}