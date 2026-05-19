import { ItemView, TFile, type WorkspaceLeaf } from "obsidian";
import { ConsentModal } from "../security/ConsentModal";
import type { ConsentDecision as SecurityConsentDecision } from "../security/types";
import { ChatViewModel } from "./ChatViewModel";
import { InputBar } from "./InputBar";
import { MessageList } from "./MessageList";
import type { ChatPluginContext, ChatConsentDecision, ToolCall } from "./types";

export const CHAT_VIEW_TYPE = "github-copilot-agent-chat";

export class ChatView extends ItemView {
  private readonly context: ChatPluginContext;
  private viewModel: ChatViewModel | null = null;
  private messageList: MessageList | null = null;
  private inputBar: InputBar | null = null;
  private switcher: HTMLSelectElement | null = null;
  private modelPicker: HTMLSelectElement | null = null;
  private authPanel: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, context: ChatPluginContext) {
    super(leaf);
    this.context = context;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    return "Copilot Agent";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("github-copilot-chat-view");
    this.viewModel = new ChatViewModel(
      this.context,
      {
        onChange: () => this.render(),
        onConsent: (toolCall) => this.openConsent(toolCall),
        readVaultFile: async (path, signal) => {
          if (signal.aborted) {
            throw new DOMException("Operation aborted", "AbortError");
          }
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) {
            throw new Error(`Vault file not found: ${path}`);
          }
          return this.app.vault.read(file);
        },
      },
      this.app
    );
    const switcherPanel = root.createDiv({ cls: "github-copilot-chat-switcher-panel" });
    this.switcher = switcherPanel.createEl("select", { cls: "github-copilot-chat-switcher" });
    this.modelPicker = switcherPanel.createEl("select", {
      cls: "github-copilot-chat-model-picker",
    });
    const newButton = switcherPanel.createEl("button", {
      text: "New",
      cls: "github-copilot-chat-new",
    });
    const messagesPanel = root.createDiv({ cls: "github-copilot-chat-message-panel" });
    const inputPanel = root.createDiv({ cls: "github-copilot-chat-input-panel" });
    this.authPanel = inputPanel.createDiv({ cls: "github-copilot-chat-auth-panel" });
    const inputBarContainer = inputPanel.createDiv({ cls: "github-copilot-chat-input-bar-panel" });
    this.messageList = new MessageList(messagesPanel, this, this.app);
    this.inputBar = new InputBar(inputBarContainer, this, this.app, {
      onSubmit: (text, attachedFiles) => {
        void this.viewModel?.sendUserMessage(text, attachedFiles);
      },
      onStop: () => this.viewModel?.stopGeneration(),
    });
    this.registerDomEvent(this.switcher, "change", () => {
      if (this.switcher?.value) {
        this.viewModel?.selectConversation(this.switcher.value);
      }
    });
    this.registerDomEvent(this.modelPicker, "change", () => {
      if (!this.modelPicker?.value) return;
      this.context.settings.selectedModel = this.modelPicker.value;
      void this.context.saveSettings?.();
    });
    this.registerDomEvent(newButton, "click", () => this.viewModel?.newConversation());
    this.render();
  }

  async onClose(): Promise<void> {
    this.viewModel?.stopGeneration();
    this.contentEl.empty();
  }

  private render(): void {
    if (!this.viewModel || !this.switcher || !this.modelPicker) {
      return;
    }
    this.switcher.empty();
    for (const conversation of this.viewModel.allConversations) {
      const option = this.switcher.createEl("option", {
        text: conversation.title,
        value: conversation.id,
      });
      option.selected = conversation.id === this.viewModel.currentConversation.id;
    }
    this.modelPicker.empty();
    const options = this.context.getModelOptions?.() ?? [];
    for (const optionValue of options) {
      const option = this.modelPicker.createEl("option", {
        text: optionValue.label,
        value: optionValue.value,
      });
      option.selected = optionValue.value === this.context.settings.selectedModel;
    }
    if (this.context.settings.selectedModel) this.modelPicker.value = this.context.settings.selectedModel;
    this.messageList?.render(this.viewModel.currentConversation.messages, this.viewModel.runState);
    this.renderAuthPanel();
    this.inputBar?.render(this.viewModel.runState === "streaming");
  }

  private renderAuthPanel(): void {
    if (!this.authPanel || !this.viewModel) return;
    this.authPanel.empty();
    this.authPanel.toggle(this.viewModel.lastErrorCode === "no_token");
    if (this.viewModel.lastErrorCode !== "no_token") return;
    this.authPanel.createSpan({
      cls: "github-copilot-chat-auth-message",
      text: "No GitHub token available.",
    });
    const button = this.authPanel.createEl("button", {
      text: "Sign in via device flow",
      cls: "github-copilot-chat-auth-signin",
    });
    this.registerDomEvent(button, "click", () => {
      void this.context.signInViaDeviceFlow?.();
    });
  }

  private openConsent(toolCall: ToolCall): Promise<ChatConsentDecision> {
    return new Promise((resolve) => {
      new ConsentModal(
        this.app,
        {
          tool: {
            name: toolCall.name,
            serverId: toolCall.serverName,
            qualifiedName: `${toolCall.serverName}__${toolCall.name}`,
          },
          serverId: toolCall.serverName,
          conversationId: "current",
          args: toolCall.arguments,
          annotations: toolCall.annotations,
        },
        (decision) => void this.toChatConsentDecision(decision).then(resolve)
      ).open();
    });
  }

  private async toChatConsentDecision(decision: SecurityConsentDecision): Promise<ChatConsentDecision> {
    if (decision.type === "allow-session") return "allow-session";
    if (decision.type === "allow-forever") {
      if (decision.serverId === "obsidian-native") {
        this.context.settings.nativeToolPolicies ??= {};
        this.context.settings.nativeToolPolicies[decision.toolName] = "auto-allow";
      } else if (Array.isArray(this.context.settings.mcpServers)) {
        const server = this.context.settings.mcpServers.find((entry) => entry.id === decision.serverId || entry.name === decision.serverId);
        if (server) {
          server.toolPolicies ??= {};
          server.toolPolicies[decision.toolName] = "auto-allow";
        }
      }
      await this.context.saveSettings?.();
      return "allow-forever";
    }
    if (decision.type === "allow-once") return "allow-once";
    if (decision.type === "deny-forever") return "deny-always";
    return "deny-once";
  }
}

export async function openChatView(leafProvider: {
  getRightLeaf(create: boolean): WorkspaceLeaf | null;
}): Promise<void> {
  const leaf = leafProvider.getRightLeaf(false) ?? leafProvider.getRightLeaf(true);
  await leaf?.setViewState({ type: CHAT_VIEW_TYPE, active: true });
}
