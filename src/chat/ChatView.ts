import { App, ItemView, Modal, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
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
  private renameInput: HTMLInputElement | null = null;
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
    root.addClass("github-copilot-chat-root");
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
    this.renameInput = switcherPanel.createEl("input", {
      cls: "github-copilot-chat-rename-input",
      attr: { type: "text" },
    });
    this.renameInput.addClass("github-copilot-chat-hidden");
    const renameButton = switcherPanel.createEl("button", {
      cls: "github-copilot-chat-icon-button github-copilot-chat-rename",
      attr: { "aria-label": "Rename conversation", title: "Rename conversation" },
    });
    setIcon(renameButton, "pencil");
    const deleteButton = switcherPanel.createEl("button", {
      cls: "github-copilot-chat-icon-button github-copilot-chat-delete",
      attr: { "aria-label": "Delete conversation", title: "Delete conversation" },
    });
    setIcon(deleteButton, "trash");
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
    this.registerDomEvent(renameButton, "click", () => this.startRename());
    this.registerDomEvent(deleteButton, "click", () => this.confirmDelete());
    this.registerDomEvent(this.renameInput, "keydown", (event) => this.handleRenameKey(event));
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
    if (!this.viewModel || !this.switcher || !this.modelPicker || !this.renameInput) {
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
    if (this.context.settings.selectedModel)
      this.modelPicker.value = this.context.settings.selectedModel;
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

  private startRename(): void {
    if (!this.viewModel || !this.switcher || !this.renameInput) return;
    this.renameInput.value = this.viewModel.currentConversation.title;
    this.switcher.addClass("github-copilot-chat-hidden");
    this.renameInput.removeClass("github-copilot-chat-hidden");
    this.renameInput.focus();
    this.renameInput.select();
  }

  private handleRenameKey(event: KeyboardEvent): void {
    if (!this.viewModel || !this.switcher || !this.renameInput) return;
    if (event.key === "Enter") {
      this.viewModel.renameConversation(
        this.viewModel.currentConversation.id,
        this.renameInput.value
      );
      this.finishRename();
    } else if (event.key === "Escape") {
      this.finishRename();
    }
  }

  private finishRename(): void {
    this.renameInput?.addClass("github-copilot-chat-hidden");
    this.switcher?.removeClass("github-copilot-chat-hidden");
  }

  private confirmDelete(): void {
    if (!this.viewModel) return;
    const conversation = this.viewModel.currentConversation;
    new DeleteConversationModal(this.app, conversation.messages.length, () => {
      this.viewModel?.deleteConversation(conversation.id);
    }).open();
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

  private async toChatConsentDecision(
    decision: SecurityConsentDecision
  ): Promise<ChatConsentDecision> {
    if (decision.type === "allow-session") return "allow-session";
    if (decision.type === "allow-forever") {
      if (decision.serverId === "obsidian-native") {
        this.context.settings.nativeToolPolicies ??= {};
        this.context.settings.nativeToolPolicies[decision.toolName] = "auto-allow";
      } else if (Array.isArray(this.context.settings.mcpServers)) {
        const server = this.context.settings.mcpServers.find(
          (entry) => entry.id === decision.serverId || entry.name === decision.serverId
        );
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

class DeleteConversationModal extends Modal {
  constructor(
    app: App,
    private readonly messageCount: number,
    private readonly onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Delete this conversation?" });
    this.contentEl.createEl("p", {
      text: `This will remove ${this.messageCount} message${this.messageCount === 1 ? "" : "s"}.`,
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    buttons
      .createEl("button", { text: "Delete", cls: "mod-warning" })
      .addEventListener("click", () => {
        this.onConfirm();
        this.close();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export async function openChatView(leafProvider: {
  getRightLeaf(create: boolean): WorkspaceLeaf | null;
}): Promise<void> {
  const leaf = leafProvider.getRightLeaf(false) ?? leafProvider.getRightLeaf(true);
  await leaf?.setViewState({ type: CHAT_VIEW_TYPE, active: true });
}
