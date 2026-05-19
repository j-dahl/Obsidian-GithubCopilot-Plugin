/* global AsyncIterable */
/* eslint-disable obsidianmd/ui/sentence-case, obsidianmd/commands/no-plugin-id-in-command-id */
import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { SettingsTab, DEFAULT_SETTINGS, type PluginSettings } from "./settings";
import { ChatView, CHAT_VIEW_TYPE, openChatView, type ChatViewModel, nativeTools } from "./chat";
import {
  AuditView,
  AUDIT_VIEW_TYPE,
  PermissionGate,
  AuditLogger,
  ConsentModal,
  buildSystemPrompt,
  wrapForLlm,
} from "./security";
import {
  McpManager,
  McpToolRegistry,
  McpDispatcher,
  McpDiscovery,
  type McpServerConfig,
} from "./mcp";
import {
  createProvider,
  type ChatCompletionProvider as BackendProvider,
  type ChatCompletionChunk,
} from "./providers";
import { CopilotSessionTokenStore, getGitHubToken, DeviceFlowModal } from "./auth";
import type {
  CallToolResult,
  ChatCompletionProvider,
  NativeToolRegistration,
  OpenAITool,
  ProviderMessage,
  StreamChunk,
  ToolCall,
} from "./chat/types";

class DeferredProvider implements ChatCompletionProvider {
  constructor(private readonly getProvider: () => BackendProvider) {}

  async *stream(request: {
    messages: ProviderMessage[];
    tools: OpenAITool[];
    signal: AbortSignal;
  }): AsyncIterable<StreamChunk> {
    for await (const chunk of this.getProvider().stream({
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
        tool_call_id: message.tool_call_id,
        tool_calls: message.tool_calls?.map((toolCall) => ({
          id: toolCall.id,
          type: "function" as const,
          function: {
            name: `${toolCall.serverName}__${toolCall.name}`,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      })),
      tools: request.tools.map((tool) => ({
        type: "function" as const,
        function: { ...tool.function, parameters: tool.function.parameters ?? { type: "object" } },
      })),
      signal: request.signal,
    })) {
      yield this.toStreamChunk(chunk);
    }
  }

  private toStreamChunk(chunk: ChatCompletionChunk): StreamChunk {
    const content = typeof chunk.delta.content === "string" ? chunk.delta.content : undefined;
    const toolCalls =
      chunk.delta.tool_calls?.map((toolCall) =>
        this.toToolCall(toolCall.id, toolCall.function.name, toolCall.function.arguments)
      ) ?? [];
    return { ...(content ? { content } : {}), ...(toolCalls.length ? { toolCalls } : {}) };
  }

  private toToolCall(id: string, qualifiedName: string, rawArgs: string): ToolCall {
    const split = qualifiedName.indexOf("__");
    const serverName = split > 0 ? qualifiedName.slice(0, split) : "obsidian-native";
    const name = split > 0 ? qualifiedName.slice(split + 2) : qualifiedName;
    let parsedArgs: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawArgs || "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        parsedArgs = parsed as Record<string, unknown>;
    } catch {
      parsedArgs = { value: rawArgs };
    }
    return { id, name, serverName, arguments: parsedArgs, status: "pending" };
  }
}

class ToolDispatcherAdapter {
  private readonly localTools = new Map<string, NativeToolRegistration>();
  constructor(private readonly mcpDispatcher: McpDispatcher) {}

  registerLocalTools(_serverName: string, tools: NativeToolRegistration[]): void {
    for (const tool of tools) this.localTools.set(tool.tool.name, tool);
  }

  async callTool(
    serverName: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<CallToolResult> {
    if (serverName === "obsidian-native") {
      const tool = this.localTools.get(name);
      if (!tool) throw new Error(`Native tool not registered: ${name}`);
      return tool.handler(args, signal);
    }
    return this.mcpDispatcher.dispatch(
      `${serverName}__${name}`,
      args,
      signal
    ) as Promise<CallToolResult>;
  }
}

class AuditLoggerAdapter {
  constructor(private readonly logger: AuditLogger) {}

  async logToolCall(entry: {
    toolCall: ToolCall;
    decision: string;
    result?: CallToolResult;
    error?: string;
    timestamp: number;
  }): Promise<void> {
    await this.logger.logToolCall(entry);
  }
}

class TrustedContentAdapter {
  constructor(private readonly appPlugin: GitHubCopilotAgentPlugin) {}

  wrapForLlm(path: string, content: string): string {
    const file = this.appPlugin.app.vault.getAbstractFileByPath(path);
    return wrapForLlm(content, file instanceof TFile ? file : null, this.appPlugin.settings);
  }
}

export default class GitHubCopilotAgentPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  provider?: BackendProvider;
  private mcpManager?: McpManager;
  private mcpRegistry?: McpToolRegistry;
  private mcpDispatcher?: McpDispatcher;
  private sessionTokenStore?: CopilotSessionTokenStore;
  private permissionGate?: PermissionGate;
  private auditLogger?: AuditLogger;
  private dispatcher?: ToolDispatcherAdapter;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.auditLogger = new AuditLogger(this.app);
    this.mcpManager = new McpManager();
    const discovered = await McpDiscovery.discoverAllConfigs().catch(() => []);
    await this.mcpManager.start(this.toMcpServerConfigs(discovered));
    this.mcpRegistry = new McpToolRegistry(this.mcpManager);
    await this.mcpRegistry.refresh().catch(() => []);
    this.mcpDispatcher = new McpDispatcher(this.mcpManager);
    this.dispatcher = new ToolDispatcherAdapter(this.mcpDispatcher);
    this.sessionTokenStore = new CopilotSessionTokenStore(() =>
      getGitHubToken({ pluginCache: { adapter: this.app.vault.adapter } })
    );
    this.provider = this.createConfiguredProvider();
    this.permissionGate = new PermissionGate(() => this.settings);

    const provider = new DeferredProvider(() => this.requireProvider());
    const context = {
      provider,
      mcpRegistry: this.mcpRegistry,
      dispatcher: this.dispatcher,
      permissionGate: this.permissionGate,
      auditLogger: new AuditLoggerAdapter(this.auditLogger),
      trustedContent: new TrustedContentAdapter(this),
      settings: this.settings,
      systemPrompt: this.buildPrompt(),
    };
    void (undefined as unknown as ChatViewModel | undefined);
    void nativeTools;
    void ConsentModal;
    this.registerView(CHAT_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ChatView(leaf, context));
    this.registerView(AUDIT_VIEW_TYPE, (leaf: WorkspaceLeaf) => new AuditView(leaf));
    this.addSettingTab(new SettingsTab(this.app, this));
    this.addRibbonIcon("bot", "Open Copilot chat", () => void this.openChat());
    this.addCommand({
      id: "github-copilot-agent:open-chat",
      name: "Open chat",
      callback: () => void this.openChat(),
    });
    this.addCommand({
      id: "github-copilot-agent:open-audit",
      name: "Open audit",
      callback: () => void this.openAudit(),
    });
    this.addCommand({
      id: "github-copilot-agent:sign-in-via-device-flow",
      name: "Sign in via device flow",
      callback: () => new DeviceFlowModal(this.app).open(),
    });
    this.addCommand({
      id: "github-copilot-agent:switch-backend",
      name: "Switch backend",
      callback: () => {
        this.settings.backend = this.nextBackend();
        void this.saveSettings();
        this.provider = this.createConfiguredProvider();
        new Notice(`Backend: ${this.settings.backend}`);
      },
    });
    new Notice("GitHub Copilot Agent loaded");
  }

  onunload(): void {
    void this.mcpManager?.stop();
    this.sessionTokenStore?.clear();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<PluginSettings>
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.provider = this.createConfiguredProvider();
  }

  private async openChat(): Promise<void> {
    await openChatView(this.app.workspace);
  }

  private async openAudit(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getRightLeaf(true);
    await leaf?.setViewState({ type: AUDIT_VIEW_TYPE, active: true });
  }

  private requireProvider(): BackendProvider {
    if (!this.provider) this.provider = this.createConfiguredProvider();
    return this.provider;
  }

  private createConfiguredProvider(): BackendProvider {
    const token = this.settings.githubToken || "missing-token";
    return createProvider(
      {
        backend: this.settings.backend,
        model: this.settings.selectedModel,
        token,
        vaultPath: ".",
        endpoint: this.settings.azureEndpoint,
        apiKey: this.settings.azureApiKey || "missing-key",
        deployment: this.settings.azureDeploymentName || this.settings.selectedModel,
        resourceEndpoint: this.settings.classicEndpoint,
      } as Parameters<typeof createProvider>[0],
      {
        obsidianVersion:
          (this.app as unknown as { getVersion?: () => string }).getVersion?.() ?? "unknown",
        pluginVersion: this.manifest.version,
        sessionTokenStore: this.sessionTokenStore,
      }
    );
  }

  private buildPrompt(): string {
    const native = nativeTools.createNativeTools(this.app).map((registration) => ({
      name: registration.tool.name,
      serverId: registration.serverName,
      description: registration.tool.description,
      inputSchema: registration.tool.inputSchema,
    }));
    const mcp =
      this.mcpRegistry?.list().map((entry) => ({
        name: entry.tool.name,
        serverId: entry.serverName,
        qualifiedName: entry.qualifiedName,
        description: entry.tool.description,
        inputSchema: entry.tool.inputSchema,
      })) ?? [];
    return [
      buildSystemPrompt({
        preset: this.settings.preset,
        tools: [...native, ...mcp],
        currentFile: this.app.workspace.getActiveFile()?.path,
      }),
      this.settings.customSystemPromptAddendum,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private toMcpServerConfigs(discovered: Array<{ config: McpServerConfig }>): McpServerConfig[] {
    const discoveredConfigs = discovered.map((server) => server.config);
    const configured = this.settings.mcpServers
      .filter((server) => server.enabled)
      .flatMap((server): McpServerConfig[] => {
        if (server.url)
          return [
            {
              name: server.name || server.id,
              transport: { type: "http", url: server.url, headers: server.headers },
              env: server.env,
            },
          ];
        if (server.command)
          return [
            {
              name: server.name || server.id,
              transport: { type: "stdio", command: server.command, args: server.args },
              env: server.env,
            },
          ];
        return [];
      });
    return [...discoveredConfigs, ...configured];
  }

  private nextBackend(): PluginSettings["backend"] {
    const order: PluginSettings["backend"][] = [
      "github-models",
      "github-copilot",
      "azure-foundry",
      "azure-openai-classic",
    ];
    return order[(order.indexOf(this.settings.backend) + 1) % order.length] ?? "github-models";
  }
}
