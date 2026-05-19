import { App } from "obsidian";
import { SettingsTab, DEFAULT_SETTINGS, type PluginSettings } from "../../src/settings";
import { settingCalls } from "./obsidianMock";

const createPlugin = () => ({
app: new App(),
manifest: { version: "0.1.0" },
settings: {
...DEFAULT_SETTINGS,
mcpServers: [{
id: "filesystem",
name: "Filesystem",
enabled: true,
autoApproveReadOnly: false,
autoApproveAll: false,
disabledTools: ["delete_file"],
command: "npx",
args: ["-y", "@modelcontextprotocol/server-filesystem"],
source: "test",
}],
} satisfies PluginSettings,
saveSettings: jest.fn(async () => undefined),
provider: { ping: jest.fn(async () => true) },
addCommand: jest.fn(),
addSettingTab: jest.fn(),
loadData: jest.fn(),
saveData: jest.fn(),
});

describe("SettingsTab", () => {
beforeEach(() => {
settingCalls.length = 0;
});

it("renders all settings sections with the Setting builder API", () => {
const plugin = createPlugin();
const tab = new SettingsTab(plugin.app, plugin);

tab.display();

expect(settingCalls).toMatchSnapshot();
});
});