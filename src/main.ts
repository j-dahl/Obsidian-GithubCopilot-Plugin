import { Plugin, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, type PluginSettings } from './settings/settings';

export default class GitHubCopilotAgentPlugin extends Plugin {
settings: PluginSettings = DEFAULT_SETTINGS;

async onload() {
await this.loadSettings();
new Notice('GitHub Copilot Agent loaded');
}

async onunload() {}

async loadSettings() {
this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
}

async saveSettings() {
await this.saveData(this.settings);
}
}
