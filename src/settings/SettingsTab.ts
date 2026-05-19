/* eslint-disable obsidianmd/ui/sentence-case */
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
  AuthError,
  clearGitHubTokenCache,
  DeviceFlowModal,
  getGitHubToken,
  runDeviceFlow,
} from "../auth";
import { discoverAllConfigs, type DiscoveredServer } from "../mcp/McpDiscovery";
import { FALLBACK_COPILOT_MODELS, getCopilotModels } from "../providers/copilotModels";
import type { ProviderFactoryDeps } from "../providers/factory";
import { ProviderError, type ModelInfo, type ProviderPingResult } from "../providers/types";
import type {
  BackendType,
  McpServerPermissionEntry,
  PluginSettings,
  SecurityPreset,
} from "./settings";

const execFile = promisify(execFileCb);
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
  provider?: { ping(): Promise<ProviderPingResult> };
  getProviderFactoryDeps?(): ProviderFactoryDeps;
};

type PasswordText = { setType(type: string): unknown; setHidden?(hidden: boolean): unknown };
type ButtonLike = {
  setDisabled?(disabled: boolean): ButtonLike;
  setTooltip?(tooltip: string): ButtonLike;
};

export class SettingsTab extends PluginSettingTab {
  private modelCatalog: ModelInfo[] = [];
  private tokenSource = "Checking...";
  private tokenForTest: string | null = null;
  private connectionStatus = "Not tested";
  private connectionDetails = "";
  private lastConnectionError: unknown = null;
  private discoveryStatus = "Not refreshed";
  private diagnosticsRefreshed = false;
  private copilotModels = [...FALLBACK_COPILOT_MODELS];
  private copilotModelsSource: "live" | "fallback" = "fallback";
  private ghCliAvailable: boolean | null = null;

  constructor(
    app: App,
    private readonly plugin: ProviderHost
  ) {
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
      .setDesc(
        "GitHub Models is the documented default; Copilot and Azure use compatible chat APIs."
      )
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(BACKEND_LABELS))
          dropdown.addOption(value, label);
        dropdown.setValue(this.settings.backend).onChange(async (value) => {
          this.settings.backend = value as BackendType;
          if (this.settings.backend === "github-copilot") await this.ensureCopilotModelSelection();
          await this.save();
          this.display();
        });
      })
      .addButton((button) =>
        button.setButtonText("Test connection").onClick(async () => {
          await this.testConnection();
        })
      );

    if (this.settings.backend === "github-models") {
      this.addPasswordSetting(
        "GitHub token",
        "PAT with models:read scope. Leave blank to use detected CLI token where supported.",
        "githubToken"
      );
      this.addTextSetting(
        "GitHub model name",
        "Model id used when the catalog is unavailable.",
        "githubModelName"
      );
    } else if (this.settings.backend === "github-copilot") {
      this.addPasswordSetting(
        "GitHub token",
        "Optional override. Cached gh/copilot token discovery is preferred.",
        "githubToken"
      );
    } else if (this.settings.backend === "azure-foundry") {
      this.addTextSetting(
        "Azure endpoint",
        "Example: https://name.openai.azure.com/openai/v1/",
        "azureEndpoint"
      );
      this.addPasswordSetting("Azure API key", "Stored in Obsidian plugin data.", "azureApiKey");
      this.addTextSetting("Deployment name", "Azure model deployment name.", "azureDeploymentName");
    } else {
      this.addTextSetting(
        "Classic endpoint",
        "Example: https://name.openai.azure.com/openai/deployments/deployment",
        "classicEndpoint"
      );
      this.addPasswordSetting(
        "Classic API key",
        "Stored in Obsidian plugin data.",
        "classicApiKey"
      );
      this.addTextSetting("Classic API version", "Default: 2024-10-21.", "classicApiVersion");
    }
  }

  private renderModelSection(): void {
    this.renderHeading("Model", "Pick a tool-calling, streaming-capable model.");
    if (this.settings.backend === "github-copilot") void this.ensureCopilotModelSelection();
    const setting = new Setting(this.containerEl)
      .setName("Selected model")
      .setDesc(this.getModelDescription())
      .addButton((button) =>
        button.setButtonText("Refresh").onClick(async () => {
          await this.refreshModels(true);
        })
      );

    if (
      this.settings.backend === "azure-foundry" ||
      this.settings.backend === "azure-openai-classic"
    ) {
      setting.addText((text) =>
        text
          .setPlaceholder("deployment-name")
          .setValue(this.getAzureDeployment())
          .onChange(async (value) => {
            if (this.settings.backend === "azure-foundry")
              this.settings.azureDeploymentName = value;
            else this.settings.classicEndpoint = value;
            this.settings.selectedModel = value;
            await this.save();
          })
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
    this.addNumberSetting(
      "Max tokens",
      "Maximum output tokens per response.",
      "maxTokens",
      256,
      32768
    );
    this.addNumberSetting(
      "Temperature",
      "Lower values are more deterministic.",
      "temperature",
      0,
      2,
      0.1
    );
    new Setting(this.containerEl)
      .setName("Stream responses")
      .setDesc("Show assistant output incrementally in the chat view.")
      .addToggle((toggle) =>
        toggle.setValue(this.settings.streamResponses).onChange(async (value) => {
          this.settings.streamResponses = value;
          await this.save();
        })
      );
    new Setting(this.containerEl)
      .setName("System prompt addendum")
      .setDesc("Optional user-controlled text appended after the built-in safety prompt.")
      .addTextArea((text) =>
        text.setValue(this.settings.customSystemPromptAddendum).onChange(async (value) => {
          this.settings.customSystemPromptAddendum = value;
          await this.save();
        })
      );
  }

  private renderPresetSection(): void {
    this.renderHeading(
      "Security preset",
      "Strict blocks most access; Balanced asks for risky actions; Trusted reduces prompts."
    );
    new Setting(this.containerEl)
      .setName("Preset")
      .setDesc("Changing this updates the built-in capability toggles.")
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(PRESET_LABELS))
          dropdown.addOption(value, label);
        dropdown.setValue(this.settings.preset).onChange(async (value) => {
          await this.applyPreset(value as SecurityPreset);
          await this.save();
          this.display();
        });
      });
  }

  private renderCapabilitiesSection(): void {
    this.renderHeading(
      "Built-in capabilities",
      "Permission gates for native vault, filesystem, environment, and network access."
    );
    this.addToggleSetting(
      "Read active file",
      "Allow reading the currently open note automatically.",
      "allowReadActiveFile"
    );
    this.addToggleSetting(
      "Read vault files",
      "Allow or ask before reading other notes in the vault.",
      "allowReadVaultFiles"
    );
    this.addToggleSetting(
      "Read external files",
      "Permit access outside the vault when explicitly requested.",
      "allowReadExternalFiles"
    );
    this.addToggleSetting(
      "Write vault files",
      "Permit note creation, edits, and deletion after consent.",
      "allowWriteVaultFiles"
    );
    this.addToggleSetting(
      "Write external files",
      "Permit writes outside the vault.",
      "allowWriteExternalFiles"
    );
    this.addToggleSetting(
      "Environment variables",
      "Permit tools to read environment variables.",
      "allowEnvVarAccess"
    );
    this.addToggleSetting("Network egress", "Permit non-LLM network tools.", "allowNetworkEgress");
    this.addToggleSetting(
      "Block destructive tools",
      "Deny destructive MCP tools unless this is disabled.",
      "blockDestructiveTools"
    );
    this.addToggleSetting(
      "Require consent for open-world tools",
      "Ask before tools that can reach uncontrolled external systems.",
      "requireConsentForOpenWorld"
    );
  }

  private renderMcpSection(): void {
    this.renderHeading("MCP servers", `Discovered server permissions. ${this.discoveryStatus}`);
    new Setting(this.containerEl)
      .setName("Discovery")
      .setDesc("Refresh editor and CLI MCP configuration files.")
      .addButton((button) =>
        button
          .setButtonText("Refresh discovery")
          .onClick(async () => this.refreshDiscoveredServers(true))
      )
      .addButton((button) =>
        button.setButtonText("Add custom server").onClick(() =>
          new CustomMcpServerModal(this.app, async (entry) => {
            this.settings.mcpServers.push(entry);
            await this.save();
            this.display();
          }).open()
        )
      );

    if (this.settings.mcpServers.length === 0) {
      new Setting(this.containerEl)
        .setName("No MCP servers discovered")
        .setDesc("Select Refresh discovery or add a custom server.");
      return;
    }

    for (const server of this.settings.mcpServers) {
      new Setting(this.containerEl)
        .setName(`${server.name || server.id}${server.enabled ? "" : " (Discovered disabled)"}`)
        .setDesc(`${this.describeServer(server)}\nEnabling this server will execute the command shown below on your machine.`)
        .addButton((button) =>
          button
            .setButtonText(server.enabled ? "Enabled" : "Enable")
            .onClick(async () => {
              if (server.enabled) return;
              server.enabled = true;
              await this.save();
              this.display();
            })
        )
        .addToggle((toggle) =>
          toggle
            .setTooltip("Enable server")
            .setValue(server.enabled)
            .onChange(async (value) => {
              server.enabled = value;
              await this.save();
            })
        )
        .addToggle((toggle) =>
          toggle
            .setTooltip("Auto-approve read-only")
            .setValue(server.autoApproveReadOnly)
            .onChange(async (value) => {
              server.autoApproveReadOnly = value;
              await this.save();
            })
        )
        .addToggle((toggle) =>
          toggle
            .setTooltip("⚠️ Auto-approve all tools")
            .setValue(server.autoApproveAll)
            .onChange(async (value) => {
              server.autoApproveAll = value;
              if (value) new Notice("Warning: this auto-approves every tool for this MCP server.");
              await this.save();
            })
        )
        .addText((text) =>
          text
            .setPlaceholder("disabled_tool, other_tool")
            .setValue(server.disabledTools.join(", "))
            .onChange(async (value) => {
              server.disabledTools = this.parseList(value);
              await this.save();
            })
        );
      if (server.url?.startsWith("http://localhost") || server.url?.startsWith("http://127.0.0.1")) {
        new Setting(this.containerEl)
          .setName("Allow insecure local HTTP")
          .setDesc("Only for local-development MCP servers on localhost.")
          .addToggle((toggle) =>
            toggle.setValue(Boolean(server.allowInsecureLocal)).onChange(async (value) => {
              server.allowInsecureLocal = value;
              await this.save();
            })
          );
      }
    }
  }

  private renderTrustedContentSection(): void {
    this.renderHeading(
      "Trusted content",
      "Notes outside these folders, or without trusted frontmatter, are treated as untrusted data."
    );
    new Setting(this.containerEl)
      .setName("Trusted folders")
      .setDesc("Comma-separated vault-relative folder names.")
      .addText((text) =>
        text.setValue(this.settings.trustedFolders.join(", ")).onChange(async (value) => {
          this.settings.trustedFolders = this.parseList(value);
          await this.save();
        })
      );
    this.addTextSetting(
      "Trusted frontmatter key",
      "A truthy frontmatter key that marks a note as trusted.",
      "trustedFrontmatterKey"
    );
  }

  private renderAuditLogSection(): void {
    this.renderHeading("Audit log", "Persistent JSONL tool-call audit trail with rotation.");
    this.addToggleSetting(
      "Enable audit log",
      "Record permission decisions and sanitized tool arguments.",
      "auditLogEnabled"
    );
    new Setting(this.containerEl)
      .setName("Max size")
      .setDesc("Rotate after this many MB; the audit writer keeps the last three files.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 50, 1)
          .setValue(this.settings.auditLogMaxSizeMb)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.settings.auditLogMaxSizeMb = value;
            await this.save();
          })
      );
    this.addTextSetting("Audit log path", "Vault-relative JSONL path.", "auditLogPath");
    new Setting(this.containerEl)
      .setName("Audit log actions")
      .addButton((button) =>
        button.setButtonText("Open audit log panel").onClick(async () => {
          await this.app.workspace
            .getRightLeaf(false)
            ?.setViewState({ type: AUDIT_VIEW_TYPE, active: true });
        })
      )
      .addButton((button) =>
        button.setButtonText("Open log file").onClick(() => this.revealAuditLog())
      );
  }

  private renderDiagnosticsSection(): void {
    this.renderHeading("Diagnostics", "Read-only environment details for troubleshooting.");
    new Setting(this.containerEl).setName("Detected token source").setDesc(this.tokenSource);
    const configIssues = this.getConfigIssues();
    new Setting(this.containerEl)
      .setName("Connection readiness")
      .setDesc(configIssues.length === 0 ? "Ready to test." : configIssues.join(" "));
    const connection = new Setting(this.containerEl)
      .setName("Last connection test")
      .setDesc(this.connectionStatus);
    if (this.connectionDetails) {
      connection.addButton((button) =>
        button.setButtonText("Copy details").onClick(async () => {
          await navigator.clipboard?.writeText(this.connectionDetails);
          new Notice("Connection details copied.");
        })
      );
    }
    if (this.isCopilotScopeMissing(this.lastConnectionError)) {
      connection
        .addButton((button) => {
          button.setButtonText("Refresh gh scope").onClick(async () => this.refreshGhScope());
          const buttonLike = button as unknown as ButtonLike;
          if (this.ghCliAvailable === false) {
            buttonLike.setDisabled?.(true);
            buttonLike.setTooltip?.("gh CLI not found on PATH");
          }
        })
        .addButton((button) =>
          button.setButtonText("Sign in via device flow").onClick(async () => this.signInViaDeviceFlow())
        );
    }
    if (this.settings.backend === "github-copilot") {
      new Setting(this.containerEl)
        .setName("Copilot models source")
        .setDesc(this.copilotModelsSource);
    }
    new Setting(this.containerEl)
      .setName("Connected MCP server count")
      .setDesc(String(this.settings.mcpServers.filter((server) => server.enabled).length));
    new Setting(this.containerEl).setName("Obsidian version").setDesc(this.getObsidianVersion());
    new Setting(this.containerEl).setName("Plugin version").setDesc(this.plugin.manifest.version);
  }

  private addTextSetting<K extends keyof PluginSettings>(name: string, desc: string, key: K): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text.setValue(this.getStringSetting(key)).onChange(async (value) => {
          this.setSettingValue(key, value);
          await this.save();
        })
      );
  }

  private getStringSetting(key: keyof PluginSettings): string {
    const value = this.settings[key];
    return typeof value === "string" ? value : "";
  }

  private addPasswordSetting<K extends keyof PluginSettings>(
    name: string,
    desc: string,
    key: K
  ): void {
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

  private addNumberSetting<K extends keyof PluginSettings>(
    name: string,
    desc: string,
    key: K,
    min: number,
    max: number,
    step = 1
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addSlider((slider) =>
        slider
          .setLimits(min, max, step)
          .setValue(Number(this.settings[key]))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.setSettingValue(key, value);
            await this.save();
          })
      );
  }

  private addToggleSetting<K extends keyof PluginSettings>(
    name: string,
    desc: string,
    key: K
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((toggle) =>
        toggle.setValue(Boolean(this.settings[key])).onChange(async (value) => {
          this.setSettingValue(key, value);
          await this.save();
        })
      );
  }

  private setSettingValue<K extends keyof PluginSettings>(
    key: K,
    value: PluginSettings[K] | string | number | boolean
  ): void {
    (this.settings as Record<keyof PluginSettings, unknown>)[key] = value;
  }

  private async applyPreset(preset: SecurityPreset): Promise<void> {
    this.settings.preset = preset;
    this.applyLocalPreset(preset);
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
    if (this.settings.backend === "github-copilot") {
      const result = await getCopilotModels(this.plugin.getProviderFactoryDeps?.().sessionTokenStore);
      this.copilotModels = result.models;
      this.copilotModelsSource = result.source;
      await this.ensureCopilotModelSelection();
      if (showNotice) {
        new Notice(
          result.source === "live"
            ? `Loaded ${result.models.length} Copilot models.`
            : "Using fallback Copilot model list (couldn't reach api.githubcopilot.com/models)"
        );
        this.display();
      }
      return;
    }
    if (this.settings.backend !== "github-models") return;
    try {
      const { getModels } = await import("../providers/catalog");
      this.modelCatalog = (await getModels(".")).filter((model) => this.supportsAgentMode(model));
      if (showNotice) new Notice(`Loaded ${this.modelCatalog.length} GitHub Models.`);
      if (showNotice) this.display();
    } catch (error) {
      if (showNotice) new Notice(`Model refresh failed: ${this.describeError(error)}`);
    }
  }

  private async refreshDiscoveredServers(showNotice: boolean): Promise<void> {
    try {
      const discovered = await discoverAllConfigs();
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

  private async testConnection(): Promise<void> {
    try {
      await this.preflightConnection();
      const provider = await this.createTestProvider();
      const result = await provider.ping();
      const backendLabel = BACKEND_LABELS[this.settings.backend] ?? this.settings.backend;
      const model = this.getConnectionModel();
      const http = result.httpStatus ? `${result.httpStatus} ` : "";
      const tokenSuffix =
        this.settings.backend === "github-models" ? `, token source: ${this.tokenSource}` : "";
      this.connectionDetails = "";
      this.lastConnectionError = null;
      this.connectionStatus = `✅ Connected to ${model || backendLabel} (${http}in ${result.latencyMs}ms${tokenSuffix})`;
      new Notice(this.connectionStatus);
    } catch (error) {
      const message = this.connectionFailureMessage(error);
      this.connectionDetails = this.connectionErrorDetails(error);
      this.lastConnectionError = error;
      this.connectionStatus = `❌ ${message}`;
      new Notice(`Connection test failed: ${message}`);
    } finally {
      this.displayDiagnosticsOnly();
    }
  }

  private async preflightConnection(): Promise<void> {
    if (!this.settings.backend) throw new ProviderError("missing_backend", "Pick a backend first.");
    if (this.settings.backend === "github-models" || this.settings.backend === "github-copilot") {
      await this.ensureGitHubToken();
      if (!this.tokenForTest) {
        throw new ProviderError(
          "missing_token",
          "No GitHub token detected. Run 'GitHub Copilot Agent: Sign in via device flow' or `gh auth login`."
        );
      }
    }
    if (this.settings.backend === "github-models" && !this.getConnectionModel()) {
      throw new ProviderError("missing_model", "Pick a model from the dropdown first.");
    }
    if (this.settings.backend === "azure-foundry") {
      this.requireConfigured(this.settings.azureEndpoint, "Azure endpoint");
      this.requireConfigured(this.settings.azureApiKey, "Azure API key");
      this.requireConfigured(this.settings.azureDeploymentName || this.settings.selectedModel, "Azure deployment");
    }
    if (this.settings.backend === "azure-openai-classic") {
      this.requireConfigured(this.settings.classicEndpoint, "Classic endpoint");
      this.requireConfigured(this.settings.classicApiKey, "Classic API key");
      this.requireConfigured(this.settings.selectedModel, "Classic deployment");
    }
  }

  private requireConfigured(value: string, label: string): void {
    if (!value?.trim()) throw new ProviderError("missing_config", `${label} is required.`);
  }

  private async ensureGitHubToken(): Promise<void> {
    if (this.settings.githubToken) {
      this.tokenSource = "Settings token";
      this.tokenForTest = this.settings.githubToken;
      return;
    }
    const auth = await getGitHubToken();
    this.tokenForTest = auth?.token ?? null;
    this.tokenSource = auth ? auth.source : "No token detected";
  }

  private async createTestProvider(): Promise<{ ping(): Promise<ProviderPingResult> }> {
    const model = this.getConnectionModel();
    const { createProvider } = await import("../providers/factory");
    return createProvider(
      {
        backend: this.settings.backend,
        model,
        token: this.tokenForTest ?? undefined,
        vaultPath: ".",
        endpoint: this.settings.azureEndpoint,
        apiKey:
          this.settings.backend === "azure-openai-classic"
            ? this.settings.classicApiKey
            : this.settings.azureApiKey,
        deployment:
          this.settings.backend === "azure-openai-classic"
            ? model
            : this.settings.azureDeploymentName || model,
        resourceEndpoint: this.settings.classicEndpoint,
        apiVersion: this.settings.classicApiVersion,
      } as Parameters<typeof createProvider>[0],
      this.plugin.getProviderFactoryDeps?.() ?? {
        obsidianVersion: this.getObsidianVersion(),
        pluginVersion: this.plugin.manifest.version,
      }
    );
  }

  private getConnectionModel(): string {
    if (this.settings.backend === "github-models") {
      return (this.settings.selectedModel || this.settings.githubModelName).trim();
    }
    if (this.settings.backend === "azure-foundry") {
      return (this.settings.azureDeploymentName || this.settings.selectedModel).trim();
    }
    return this.settings.selectedModel.trim();
  }

  private getConfigIssues(): string[] {
    const issues: string[] = [];
    if (!this.settings.backend) issues.push("Pick a backend first.");
    if (
      (this.settings.backend === "github-models" || this.settings.backend === "github-copilot") &&
      !this.settings.githubToken &&
      !this.tokenForTest
    ) {
      issues.push("No GitHub token detected.");
    }
    if (this.settings.backend === "github-models" && !this.getConnectionModel()) {
      issues.push("Pick a model from the dropdown first.");
    }
    if (this.settings.backend === "azure-foundry") {
      if (!this.settings.azureEndpoint) issues.push("Azure endpoint is required.");
      if (!this.settings.azureApiKey) issues.push("Azure API key is required.");
      if (!this.settings.azureDeploymentName && !this.settings.selectedModel)
        issues.push("Azure deployment is required.");
    }
    if (this.settings.backend === "azure-openai-classic") {
      if (!this.settings.classicEndpoint) issues.push("Classic endpoint is required.");
      if (!this.settings.classicApiKey) issues.push("Classic API key is required.");
      if (!this.settings.selectedModel) issues.push("Classic deployment is required.");
    }
    return issues;
  }

  private connectionFailureMessage(error: unknown): string {
    const status = this.errorStatus(error);
    const backend = BACKEND_LABELS[this.settings.backend] ?? this.settings.backend;
    const model = this.getConnectionModel() || backend;
    if (this.isCopilotScopeMissing(error)) {
      return "Your GitHub token is missing the required `copilot` scope (the `/copilot_internal/v2/token` endpoint refused with HTTP 404). Options:\n  • If you have `gh` installed, click 'Refresh gh scope' below to run `gh auth refresh -s copilot`\n  • Click 'Sign in via device flow' to get a fresh token with the right scopes\n  • If you have the new `@github/copilot` CLI installed and signed in, its token already includes `copilot` scope — the plugin will use it after you reload (or run `cmdkey /list:copilot-cli/*` to confirm it's there)";
    }
    if (status === 401) {
      return "401 unauthorized. Your token may lack the required scope (`models:read` for GitHub Models, `copilot` for Copilot). Try: `gh auth refresh -s models:read,copilot` then reload.";
    }
    if (status === 403) {
      return `403 forbidden. Your account may not have access to ${model}. For GitHub Models you need either a Copilot subscription OR opt-in to the free tier at github.com/settings/billing/models. For Copilot API you need an active Copilot subscription.`;
    }
    if (status === 404) {
      return "404 not found. The endpoint or model name is wrong. Make sure you used `publisher/name` format (e.g. `openai/gpt-4.1`).";
    }
    if (status === 429) {
      return "429 rate-limited. You've hit your tier's request quota. Wait a few minutes or upgrade tier.";
    }
    if (status !== undefined && status >= 500) {
      return `${status} server error from ${backend}. Try again in a minute.`;
    }
    const message = this.describeError(error);
    if (this.isNetworkError(error, message)) {
      return `Network error: ${message}. Check connectivity, proxy, or firewall.`;
    }
    if (error instanceof ProviderError && error.code.startsWith("missing_")) return error.message;
    const code = error instanceof ProviderError || error instanceof AuthError ? error.code : "unknown_error";
    return `${code}: ${message.slice(0, 200)}. Use Copy details for the full error.`;
  }

  private connectionErrorDetails(error: unknown): string {
    const code = error instanceof ProviderError || error instanceof AuthError ? error.code : "unknown_error";
    const tokenSource = error instanceof AuthError && error.tokenSource ? `\ntokenSource=${error.tokenSource}` : "";
    const status = this.errorStatus(error) ?? "n/a";
    return `backend=${this.settings.backend}
model=${this.getConnectionModel()}
status=${status}
code=${code}
message=${this.describeError(error)}${tokenSource}`;
  }

  private errorStatus(error: unknown): number | undefined {
    if (error instanceof ProviderError) return error.httpStatus;
    if (error instanceof AuthError) return error.httpStatus;
    const status = (error as { status?: unknown })?.status;
    return typeof status === "number" ? status : undefined;
  }

  private isNetworkError(error: unknown, message: string): boolean {
    const code = error instanceof ProviderError ? error.code : "";
    return (
      /network|fetch|failed to fetch|ECONN|ENOTFOUND|ETIMEDOUT|certificate|proxy|firewall/i.test(
        `${code} ${message}`
      ) && this.errorStatus(error) === undefined
    );
  }

  private isCopilotScopeMissing(error: unknown): boolean {
    if (error instanceof AuthError && error.code === "copilot_scope_missing") return true;
    if (error instanceof ProviderError && error.cause instanceof AuthError) {
      return error.cause.code === "copilot_scope_missing";
    }
    return false;
  }

  private async refreshDiagnostics(): Promise<void> {
    void this.refreshGhAvailability();
    if (this.settings.githubToken) {
      this.tokenSource = "Settings token";
      this.tokenForTest = this.settings.githubToken;
      this.displayDiagnosticsOnly();
      return;
    }
    try {
      const auth = await getGitHubToken();
      this.tokenForTest = auth?.token ?? null;
      this.tokenSource = auth ? auth.source : "No token detected";
    } catch {
      this.tokenForTest = null;
      this.tokenSource = "Token discovery unavailable";
    }
    this.displayDiagnosticsOnly();
  }

  private async refreshGhAvailability(): Promise<void> {
    const previous = this.ghCliAvailable;
    try {
      await execFile("gh", ["--version"], { timeout: 5000 });
      this.ghCliAvailable = true;
    } catch {
      this.ghCliAvailable = false;
    }
    if (previous !== this.ghCliAvailable) this.displayDiagnosticsOnly();
  }

  private displayDiagnosticsOnly(): void {
    this.diagnosticsRefreshed = true;
    if (this.containerEl.isShown()) this.display();
  }

  private async refreshGhScope(): Promise<void> {
    new Notice("Open `gh` window to approve");
    try {
      await execFile("gh", ["auth", "refresh", "-s", "copilot"], { timeout: 60000 });
      this.clearAuthCaches();
      await this.testConnection();
    } catch (error) {
      new Notice(`Could not refresh gh scope: ${this.describeError(error)}`);
    }
  }

  private async signInViaDeviceFlow(): Promise<void> {
    const modal = new DeviceFlowModal(this.app);
    modal.open();
    try {
      const result = await runDeviceFlow({
        showProgress: modal.updateProgress.bind(modal),
        signal: modal.signal,
        cache: undefined,
      });
      this.settings.githubToken = result.token;
      this.clearAuthCaches();
      await this.save();
      modal.close();
      new Notice("Signed in to GitHub");
      await this.testConnection();
    } catch (error) {
      modal.showError(error instanceof Error ? error.message : String(error));
    }
  }

  private clearAuthCaches(): void {
    clearGitHubTokenCache();
    this.plugin.getProviderFactoryDeps?.().sessionTokenStore?.clear?.();
    this.tokenForTest = null;
    this.tokenSource = "Checking...";
  }

  private async ensureCopilotModelSelection(): Promise<void> {
    if (this.settings.backend !== "github-copilot") return;
    if (this.copilotModels.includes(this.settings.selectedModel)) return;
    this.settings.selectedModel = this.copilotModels[0] ?? FALLBACK_COPILOT_MODELS[0] ?? "gpt-4o";
    await this.save();
  }

  private getModelOptions(): Array<{ value: string; label: string }> {
    if (this.settings.backend === "github-copilot")
      return this.copilotModels.map((model) => ({ value: model, label: model }));
    const catalog: Array<Pick<ModelInfo, "id" | "name" | "publisher">> =
      this.modelCatalog.length > 0
        ? this.modelCatalog
        : [
            {
              id: this.settings.githubModelName || "openai/gpt-4.1",
              name: this.settings.githubModelName || "openai/gpt-4.1",
              publisher: "OpenAI",
            },
          ];
    return catalog.map((model) => ({
      value: model.id,
      label: `${model.publisher || "Unknown"} / ${model.name || model.id}`,
    }));
  }

  private getModelDescription(): string {
    if (this.settings.backend === "github-models")
      return "Live catalog is grouped by publisher when available.";
    if (this.settings.backend === "github-copilot")
      return "Copilot subscriptions expose a curated model list.";
    return "Azure models are selected by deployment name.";
  }

  private getAzureDeployment(): string {
    return this.settings.backend === "azure-foundry"
      ? this.settings.azureDeploymentName
      : this.settings.classicEndpoint;
  }

  private supportsAgentMode(model: ModelInfo): boolean {
    return model.supportsTools && model.supportsStreaming;
  }

  private mergeDiscoveredServers(discovered: DiscoveredServer[]): void {
    for (const server of discovered) {
      const config = server.config;
      const id = config.name;
      if (!id || this.settings.mcpServers.some((existing) => existing.id === id)) continue;
      this.settings.mcpServers.push({
        id,
        name: config.name,
        enabled: false,
        autoApproveReadOnly: false,
        autoApproveAll: false,
        disabledTools: [],
        toolPolicies: {},
        command: config.transport.type === "stdio" ? config.transport.command : undefined,
        args: config.transport.type === "stdio" ? config.transport.args : undefined,
        env: config.env,
        url: config.transport.type !== "stdio" ? config.transport.url : undefined,
        headers: config.transport.type !== "stdio" ? config.transport.headers : undefined,
        source: server.source,
      });
    }
  }

  private describeServer(server: McpServerPermissionEntry): string {
    const transport = server.url
      ? server.url
      : [server.command, ...(server.args || [])].filter(Boolean).join(" ");
    return `${server.source || "custom"}: ${transport || "configuration pending"}`;
  }

  private parseList(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private revealAuditLog(): void {
    try {
      const electron = (
        window as unknown as {
          require?: (module: string) => { shell?: { showItemInFolder(path: string): void } };
        }
      ).require?.("electron");
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

  constructor(
    app: App,
    private readonly onSubmit: (entry: McpServerPermissionEntry) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    new Setting(this.contentEl).setName("Add custom server").setHeading();
    new Setting(this.contentEl).setName("Name").addText((text) =>
      text.setValue(this.name).onChange((value) => {
        this.name = value;
      })
    );
    new Setting(this.contentEl)
      .setName("Command")
      .setDesc("For stdio servers, set command and optional args.")
      .addText((text) =>
        text.onChange((value) => {
          this.command = value;
        })
      );
    new Setting(this.contentEl)
      .setName("Args")
      .setDesc("Comma-separated command arguments.")
      .addText((text) =>
        text.onChange((value) => {
          this.args = value;
        })
      );
    new Setting(this.contentEl)
      .setName("Env")
      .setDesc("Comma-separated KEY=VALUE entries.")
      .addText((text) =>
        text.onChange((value) => {
          this.env = value;
        })
      );
    new Setting(this.contentEl)
      .setName("URL")
      .setDesc("For HTTP/SSE servers, set a URL instead of command.")
      .addText((text) =>
        text.onChange((value) => {
          this.url = value;
        })
      );
    new Setting(this.contentEl)
      .setName("Headers")
      .setDesc("Comma-separated KEY=VALUE entries.")
      .addText((text) =>
        text.onChange((value) => {
          this.headers = value;
        })
      );
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Add server")
        .setCta()
        .onClick(async () => {
          await this.onSubmit(this.toEntry());
          this.close();
        })
    );
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
      toolPolicies: {},
      command: this.command.trim() || undefined,
      args: this.parseList(this.args),
      env: this.parseKeyValueList(this.env),
      url: this.url.trim() || undefined,
      headers: this.parseKeyValueList(this.headers),
      source: "custom",
    };
  }

  private parseList(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
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
