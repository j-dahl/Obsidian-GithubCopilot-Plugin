/* eslint-disable obsidianmd/ui/sentence-case */
import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type {
CatalogModelInfo,
CatalogModule,
GitHubTokenModule,
McpDiscoveredServer,
McpDiscoveryModule,
PresetsModule,
} from "./_pending-imports";
import type { BackendType, McpServerPermissionEntry, PluginSettings, SecurityPreset } from "./settings";

const COPILOT_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3", "o4-mini", "claude-3.5-sonnet"];
const BACKEND_LABELS: Record<BackendType, string> = {
"github-models": "GitHub Models",
"github-copilot": "GitHub Copilot",
"azure-foundry": "Azure Foundry / OpenAI v1",
"azure-openai-classic": "Azure OpenAI classic",
};
const PRESET_LABELS: Record<SecurityPreset, string> = {
strict: "Strict",
balanced: "Balanced",
trusted: "Trusted workspace",
};
const AUDIT_VIEW_TYPE = "github-copilot-agent-audit";

type ProviderHost = Plugin & {
settings: PluginSettings;
saveSettings(): Promise<void>;
provider?: { ping(): Promise<boolean> };
};

type PasswordText = { setType(type: string): unknown; setHidden?(hidden: boolean): unknown };

export class SettingsTab extends PluginSettingTab {
private modelCatalog: CatalogModelInfo[] = [];
private tokenSource = "Checking...";
private discoveryStatus = "Not refreshed";
	private diagnosticsRefreshed = false;

constructor(app: App, private readonly plugin: ProviderHost) {
super(app, plugin);
}

display(): void {
this.containerEl.empty();
this.renderBackendSection();
this.renderModelSection();
this.renderPresetSection();
this.renderCapabilitiesSection();
this.renderMcpSection();
this.renderTrustedContentSection();
this.renderAuditLogSection();
this.renderDiagnosticsSection();
if (!this.diagnosticsRefreshed) void this.refreshDiagnostics();
void this.refreshDiscoveredServers(false);
void this.refreshModels(false);
}

private get settings(): PluginSettings {
return this.plugin.settings;
}

private async save(): Promise<void> {
await this.plugin.saveSettings();
}

private renderHeading(name: string, desc?: string): void {
const setting = new Setting(this.containerEl).setName(name).setHeading();
if (desc) setting.setDesc(desc);
}

private renderBackendSection(): void {
this.renderHeading("Backend", "Choose the API surface and configure credentials.");
new Setting(this.containerEl)
.setName("Backend")
.setDesc("GitHub Models is the documented default; Copilot and Azure use compatible chat APIs.")
.addDropdown((dropdown) => {
for (const [value, label] of Object.entries(BACKEND_LABELS)) dropdown.addOption(value, label);
dropdown.setValue(this.settings.backend).onChange(async (value) => {
this.settings.backend = value as BackendType;
await this.save();
this.display();
});
})
.addButton((button) =>
button.setButtonText("Test connection").onClick(async () => {
try {
const ok = await this.plugin.provider?.ping();
new Notice(ok ? "Connection test succeeded." : "Connection test is not available yet.");
} catch (error) {
new Notice(`Connection test failed: ${this.describeError(error)}`);
}
}),
);

if (this.settings.backend === "github-models") {
this.addPasswordSetting("GitHub token", "PAT with models:read scope. Leave blank to use detected CLI token where supported.", "githubToken");
this.addTextSetting("GitHub model name", "Model id used when the catalog is unavailable.", "githubModelName");
} else if (this.settings.backend === "github-copilot") {
this.addPasswordSetting("GitHub token", "Optional override. Cached gh/copilot token discovery is preferred.", "githubToken");
} else if (this.settings.backend === "azure-foundry") {
this.addTextSetting("Azure endpoint", "Example: https://name.openai.azure.com/openai/v1/", "azureEndpoint");
this.addPasswordSetting("Azure API key", "Stored in Obsidian plugin data.", "azureApiKey");
this.addTextSetting("Deployment name", "Azure model deployment name.", "azureDeploymentName");
} else {
this.addTextSetting("Classic endpoint", "Example: https://name.openai.azure.com/openai/deployments/deployment", "classicEndpoint");
this.addPasswordSetting("Classic API key", "Stored in Obsidian plugin data.", "classicApiKey");
this.addTextSetting("Classic API version", "Default: 2024-10-21.", "classicApiVersion");
}
}

private renderModelSection(): void {
this.renderHeading("Model", "Pick a tool-calling, streaming-capable model.");
const setting = new Setting(this.containerEl)
.setName("Selected model")
.setDesc(this.getModelDescription())
.addButton((button) =>
button.setButtonText("Refresh").onClick(async () => {
await this.refreshModels(true);
}),
);

if (this.settings.backend === "azure-foundry" || this.settings.backend === "azure-openai-classic") {
setting.addText((text) =>
text.setPlaceholder("deployment-name").setValue(this.getAzureDeployment()).onChange(async (value) => {
if (this.settings.backend === "azure-foundry") this.settings.azureDeploymentName = value;
else this.settings.classicEndpoint = value;
this.settings.selectedModel = value;
await this.save();
}),
);
return;
}

setting.addDropdown((dropdown) => {
for (const option of this.getModelOptions()) dropdown.addOption(option.value, option.label);
dropdown.setValue(this.settings.selectedModel).onChange(async (value) => {
this.settings.selectedModel = value;
if (this.settings.backend === "github-models") this.settings.githubModelName = value;
await this.save();
});
});
this.addNumberSetting("Max tokens", "Maximum output tokens per response.", "maxTokens", 256, 32768);
this.addNumberSetting("Temperature", "Lower values are more deterministic.", "temperature", 0, 2, 0.1);
new Setting(this.containerEl)
.setName("Stream responses")
.setDesc("Show assistant output incrementally in the chat view.")
.addToggle((toggle) => toggle.setValue(this.settings.streamResponses).onChange(async (value) => {
this.settings.streamResponses = value;
await this.save();
}));
new Setting(this.containerEl)
.setName("System prompt addendum")
.setDesc("Optional user-controlled text appended after the built-in safety prompt.")
.addTextArea((text) => text.setValue(this.settings.customSystemPromptAddendum).onChange(async (value) => {
this.settings.customSystemPromptAddendum = value;
await this.save();
}));
}

private renderPresetSection(): void {
this.renderHeading("Security preset", "Strict blocks most access; Balanced asks for risky actions; Trusted reduces prompts.");
new Setting(this.containerEl)
.setName("Preset")
.setDesc("Changing this updates the built-in capability toggles.")
.addDropdown((dropdown) => {
for (const [value, label] of Object.entries(PRESET_LABELS)) dropdown.addOption(value, label);
dropdown.setValue(this.settings.preset).onChange(async (value) => {
await this.applyPreset(value as SecurityPreset);
await this.save();
this.display();
});
});
}

private renderCapabilitiesSection(): void {
this.renderHeading("Built-in capabilities", "Permission gates for native vault, filesystem, environment, and network access.");
this.addToggleSetting("Read active file", "Allow reading the currently open note automatically.", "allowReadActiveFile");
this.addToggleSetting("Read vault files", "Allow or ask before reading other notes in the vault.", "allowReadVaultFiles");
this.addToggleSetting("Read external files", "Permit access outside the vault when explicitly requested.", "allowReadExternalFiles");
this.addToggleSetting("Write vault files", "Permit note creation, edits, and deletion after consent.", "allowWriteVaultFiles");
this.addToggleSetting("Write external files", "Permit writes outside the vault.", "allowWriteExternalFiles");
this.addToggleSetting("Environment variables", "Permit tools to read environment variables.", "allowEnvVarAccess");
this.addToggleSetting("Network egress", "Permit non-LLM network tools.", "allowNetworkEgress");
this.addToggleSetting("Block destructive tools", "Deny destructive MCP tools unless this is disabled.", "blockDestructiveTools");
this.addToggleSetting("Require consent for open-world tools", "Ask before tools that can reach uncontrolled external systems.", "requireConsentForOpenWorld");
}

private renderMcpSection(): void {
this.renderHeading("MCP servers", `Discovered server permissions. ${this.discoveryStatus}`);
new Setting(this.containerEl)
.setName("Discovery")
.setDesc("Refresh editor and CLI MCP configuration files.")
.addButton((button) => button.setButtonText("Refresh discovery").onClick(async () => this.refreshDiscoveredServers(true)))
.addButton((button) => button.setButtonText("Add custom server").onClick(() => new CustomMcpServerModal(this.app, async (entry) => {
this.settings.mcpServers.push(entry);
await this.save();
this.display();
}).open()));

if (this.settings.mcpServers.length === 0) {
new Setting(this.containerEl).setName("No MCP servers discovered").setDesc("Select Refresh discovery or add a custom server.");
return;
}

for (const server of this.settings.mcpServers) {
new Setting(this.containerEl)
.setName(server.name || server.id)
.setDesc(this.describeServer(server))
.addToggle((toggle) => toggle.setTooltip("Enable server").setValue(server.enabled).onChange(async (value) => {
server.enabled = value;
await this.save();
}))
.addToggle((toggle) => toggle.setTooltip("Auto-approve read-only").setValue(server.autoApproveReadOnly).onChange(async (value) => {
server.autoApproveReadOnly = value;
await this.save();
}))
.addToggle((toggle) => toggle.setTooltip("⚠️ Auto-approve all tools").setValue(server.autoApproveAll).onChange(async (value) => {
server.autoApproveAll = value;
if (value) new Notice("Warning: this auto-approves every tool for this MCP server.");
await this.save();
}))
.addText((text) => text.setPlaceholder("disabled_tool, other_tool").setValue(server.disabledTools.join(", ")).onChange(async (value) => {
server.disabledTools = this.parseList(value);
await this.save();
}));
}
}

private renderTrustedContentSection(): void {
this.renderHeading("Trusted content", "Notes outside these folders, or without trusted frontmatter, are treated as untrusted data.");
new Setting(this.containerEl)
.setName("Trusted folders")
.setDesc("Comma-separated vault-relative folder names.")
.addText((text) => text.setValue(this.settings.trustedFolders.join(", ")).onChange(async (value) => {
this.settings.trustedFolders = this.parseList(value);
await this.save();
}));
this.addTextSetting("Trusted frontmatter key", "A truthy frontmatter key that marks a note as trusted.", "trustedFrontmatterKey");
}

private renderAuditLogSection(): void {
this.renderHeading("Audit log", "Persistent JSONL tool-call audit trail with rotation.");
this.addToggleSetting("Enable audit log", "Record permission decisions and sanitized tool arguments.", "auditLogEnabled");
new Setting(this.containerEl)
.setName("Max size")
.setDesc("Rotate after this many MB; the audit writer keeps the last three files.")
.addSlider((slider) => slider.setLimits(1, 50, 1).setValue(this.settings.auditLogMaxSizeMb).setDynamicTooltip().onChange(async (value) => {
this.settings.auditLogMaxSizeMb = value;
await this.save();
}));
this.addTextSetting("Audit log path", "Vault-relative JSONL path.", "auditLogPath");
new Setting(this.containerEl)
.setName("Audit log actions")
.addButton((button) => button.setButtonText("Open audit log panel").onClick(async () => {
await this.app.workspace.getRightLeaf(false)?.setViewState({ type: AUDIT_VIEW_TYPE, active: true });
}))
.addButton((button) => button.setButtonText("Open log file").onClick(() => this.revealAuditLog()));
}

private renderDiagnosticsSection(): void {
this.renderHeading("Diagnostics", "Read-only environment details for troubleshooting.");
new Setting(this.containerEl).setName("Detected token source").setDesc(this.tokenSource);
new Setting(this.containerEl).setName("Connected MCP server count").setDesc(String(this.settings.mcpServers.filter((server) => server.enabled).length));
new Setting(this.containerEl).setName("Obsidian version").setDesc(this.getObsidianVersion());
new Setting(this.containerEl).setName("Plugin version").setDesc(this.plugin.manifest.version);
}

private addTextSetting<K extends keyof PluginSettings>(name: string, desc: string, key: K): void {
new Setting(this.containerEl)
.setName(name)
.setDesc(desc)
.addText((text) => text.setValue(this.getStringSetting(key)).onChange(async (value) => {
this.setSettingValue(key, value);
await this.save();
}));
}

private getStringSetting(key: keyof PluginSettings): string {
const value = this.settings[key];
return typeof value === "string" ? value : "";
}

private addPasswordSetting<K extends keyof PluginSettings>(name: string, desc: string, key: K): void {
new Setting(this.containerEl)
.setName(name)
.setDesc(desc)
.addText((text) => {
(text as unknown as PasswordText).setType("password");
text.setValue(this.getStringSetting(key)).onChange(async (value) => {
this.setSettingValue(key, value);
await this.save();
});
});
}

private addNumberSetting<K extends keyof PluginSettings>(name: string, desc: string, key: K, min: number, max: number, step = 1): void {
new Setting(this.containerEl)
.setName(name)
.setDesc(desc)
.addSlider((slider) => slider.setLimits(min, max, step).setValue(Number(this.settings[key])).setDynamicTooltip().onChange(async (value) => {
this.setSettingValue(key, value);
await this.save();
}));
}

private addToggleSetting<K extends keyof PluginSettings>(name: string, desc: string, key: K): void {
new Setting(this.containerEl)
.setName(name)
.setDesc(desc)
.addToggle((toggle) => toggle.setValue(Boolean(this.settings[key])).onChange(async (value) => {
this.setSettingValue(key, value);
await this.save();
}));
}

private setSettingValue<K extends keyof PluginSettings>(key: K, value: PluginSettings[K] | string | number | boolean): void {
(this.settings as Record<keyof PluginSettings, unknown>)[key] = value;
}

private async applyPreset(preset: SecurityPreset): Promise<void> {
this.settings.preset = preset;
try {
const modulePath = "security/presets";
const presets = (await import(modulePath)) as PresetsModule;
const updated = presets.applyPreset(this.settings, preset);
if (updated) this.plugin.settings = updated;
} catch {
this.applyLocalPreset(preset);
}
}

private applyLocalPreset(preset: SecurityPreset): void {
this.settings.allowReadActiveFile = true;
this.settings.allowReadVaultFiles = preset === "trusted";
this.settings.allowReadExternalFiles = false;
this.settings.allowWriteVaultFiles = false;
this.settings.allowWriteExternalFiles = false;
this.settings.allowEnvVarAccess = false;
this.settings.allowNetworkEgress = false;
this.settings.blockDestructiveTools = preset !== "trusted";
this.settings.requireConsentForOpenWorld = true;
}

private async refreshModels(showNotice: boolean): Promise<void> {
if (this.settings.backend !== "github-models") return;
try {
const modulePath = "providers/catalog";
const catalog = (await import(modulePath)) as CatalogModule;
this.modelCatalog = (await catalog.getModels()).filter((model) => this.supportsAgentMode(model));
if (showNotice) new Notice(`Loaded ${this.modelCatalog.length} GitHub Models.`);
if (showNotice) this.display();
} catch (error) {
if (showNotice) new Notice(`Model refresh failed: ${this.describeError(error)}`);
}
}

private async refreshDiscoveredServers(showNotice: boolean): Promise<void> {
try {
const modulePath = "mcp/McpDiscovery";
const module = (await import(modulePath)) as McpDiscoveryModule;
const discovered = await module.McpDiscovery.discoverAllConfigs();
this.mergeDiscoveredServers(discovered);
this.discoveryStatus = `Found ${discovered.length} server${discovered.length === 1 ? "" : "s"}.`;
await this.save();
if (showNotice) new Notice(this.discoveryStatus);
if (showNotice) this.display();
} catch (error) {
this.discoveryStatus = "Discovery unavailable until the MCP module is built.";
if (showNotice) new Notice(`MCP discovery failed: ${this.describeError(error)}`);
}
}

private async refreshDiagnostics(): Promise<void> {
if (this.settings.githubToken) {
this.tokenSource = "Settings token";
this.displayDiagnosticsOnly();
return;
}
try {
const modulePath = "auth/getGitHubToken";
const auth = (await import(modulePath)) as GitHubTokenModule;
this.tokenSource = (await auth.getGitHubToken()) ? "Cached gh/copilot token" : "No token detected";
} catch {
this.tokenSource = "Token discovery unavailable";
}
this.displayDiagnosticsOnly();
}

private displayDiagnosticsOnly(): void {
		this.diagnosticsRefreshed = true;
		if (this.containerEl.isShown()) this.display();
	}

private getModelOptions(): Array<{ value: string; label: string }> {
if (this.settings.backend === "github-copilot") return COPILOT_MODELS.map((model) => ({ value: model, label: model }));
const catalog = this.modelCatalog.length > 0 ? this.modelCatalog : [{ id: this.settings.githubModelName || "openai/gpt-4.1", publisher: "OpenAI" }];
return catalog.map((model) => ({ value: model.id, label: `${model.publisher || "Unknown"} / ${model.name || model.id}` }));
}

private getModelDescription(): string {
if (this.settings.backend === "github-models") return "Live catalog is grouped by publisher when available.";
if (this.settings.backend === "github-copilot") return "Copilot subscriptions expose a curated model list.";
return "Azure models are selected by deployment name.";
}

private getAzureDeployment(): string {
return this.settings.backend === "azure-foundry" ? this.settings.azureDeploymentName : this.settings.classicEndpoint;
}

private supportsAgentMode(model: CatalogModelInfo): boolean {
const capabilities = model.capabilities || [];
return capabilities.length === 0 || (capabilities.includes("tool-calling") && capabilities.includes("streaming"));
}

private mergeDiscoveredServers(discovered: McpDiscoveredServer[]): void {
for (const server of discovered) {
const id = server.id || server.name || server.url || server.command;
if (!id || this.settings.mcpServers.some((existing) => existing.id === id)) continue;
this.settings.mcpServers.push({
id,
name: server.name || id,
enabled: true,
autoApproveReadOnly: false,
autoApproveAll: false,
disabledTools: [],
command: server.command,
args: server.args,
env: server.env,
url: server.url,
headers: server.headers,
source: server.source,
});
}
}

private describeServer(server: McpServerPermissionEntry): string {
const transport = server.url ? server.url : [server.command, ...(server.args || [])].filter(Boolean).join(" ");
return `${server.source || "custom"}: ${transport || "configuration pending"}`;
}

private parseList(value: string): string[] {
return value.split(",").map((item) => item.trim()).filter(Boolean);
}

private revealAuditLog(): void {
try {
const electron = (window as unknown as { require?: (module: string) => { shell?: { showItemInFolder(path: string): void } } }).require?.("electron");
electron?.shell?.showItemInFolder(this.settings.auditLogPath);
if (!electron?.shell) window.open(this.settings.auditLogPath);
} catch (error) {
new Notice(`Could not open audit log: ${this.describeError(error)}`);
}
}

private getObsidianVersion(): string {
return (this.app as unknown as { getVersion?: () => string }).getVersion?.() || "Unknown";
}

private describeError(error: unknown): string {
return error instanceof Error ? error.message : String(error);
}
}

class CustomMcpServerModal extends Modal {
private name = "Custom MCP server";
private command = "";
private args = "";
private env = "";
private url = "";
private headers = "";

constructor(app: App, private readonly onSubmit: (entry: McpServerPermissionEntry) => Promise<void>) {
super(app);
}

onOpen(): void {
this.contentEl.empty();
new Setting(this.contentEl).setName("Add custom server").setHeading();
new Setting(this.contentEl).setName("Name").addText((text) => text.setValue(this.name).onChange((value) => {
this.name = value;
}));
new Setting(this.contentEl).setName("Command").setDesc("For stdio servers, set command and optional args.").addText((text) => text.onChange((value) => {
this.command = value;
}));
new Setting(this.contentEl).setName("Args").setDesc("Comma-separated command arguments.").addText((text) => text.onChange((value) => {
this.args = value;
}));
new Setting(this.contentEl).setName("Env").setDesc("Comma-separated KEY=VALUE entries.").addText((text) => text.onChange((value) => {
this.env = value;
}));
new Setting(this.contentEl).setName("URL").setDesc("For HTTP/SSE servers, set a URL instead of command.").addText((text) => text.onChange((value) => {
this.url = value;
}));
new Setting(this.contentEl).setName("Headers").setDesc("Comma-separated KEY=VALUE entries.").addText((text) => text.onChange((value) => {
this.headers = value;
}));
new Setting(this.contentEl).addButton((button) => button.setButtonText("Add server").setCta().onClick(async () => {
await this.onSubmit(this.toEntry());
this.close();
}));
}

onClose(): void {
this.contentEl.empty();
}

private toEntry(): McpServerPermissionEntry {
const id = this.name.trim() || this.url.trim() || this.command.trim() || "custom-mcp-server";
return {
id,
name: this.name.trim() || id,
enabled: true,
autoApproveReadOnly: false,
autoApproveAll: false,
disabledTools: [],
command: this.command.trim() || undefined,
args: this.parseList(this.args),
env: this.parseKeyValueList(this.env),
url: this.url.trim() || undefined,
headers: this.parseKeyValueList(this.headers),
source: "custom",
};
}

private parseList(value: string): string[] {
return value.split(",").map((item) => item.trim()).filter(Boolean);
}

private parseKeyValueList(value: string): Record<string, string> | undefined {
const pairs = this.parseList(value);
if (pairs.length === 0) return undefined;
const record: Record<string, string> = {};
for (const pair of pairs) {
const separator = pair.indexOf("=");
if (separator === -1) continue;
record[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
}
return record;
}
}