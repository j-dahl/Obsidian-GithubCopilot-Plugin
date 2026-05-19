import { ItemView, TFile, type WorkspaceLeaf } from 'obsidian';
import { ConsentModal } from 'security/ConsentModal';
import { ChatViewModel } from './ChatViewModel';
import { InputBar } from './InputBar';
import { MessageList } from './MessageList';
import type { ChatPluginContext, ConsentDecision, ToolCall } from './types';

export const CHAT_VIEW_TYPE = 'github-copilot-agent-chat';

export class ChatView extends ItemView {
private readonly context: ChatPluginContext;
private viewModel: ChatViewModel | null = null;
private messageList: MessageList | null = null;
private inputBar: InputBar | null = null;
private switcher: HTMLSelectElement | null = null;

constructor(leaf: WorkspaceLeaf, context: ChatPluginContext) {
super(leaf);
this.context = context;
}

getViewType(): string {
return CHAT_VIEW_TYPE;
}

getDisplayText(): string {
// eslint-disable-next-line obsidianmd/ui/sentence-case
return 'Copilot Agent';
}

getIcon(): string {
return 'bot';
}

async onOpen(): Promise<void> {
const root = this.contentEl;
root.empty();
root.addClass('github-copilot-chat-view');
this.viewModel = new ChatViewModel(
this.context,
{
onChange: () => this.render(),
onConsent: (toolCall) => this.openConsent(toolCall),
readVaultFile: async (path, signal) => {
if (signal.aborted) {
throw new DOMException('Operation aborted', 'AbortError');
}
const file = this.app.vault.getAbstractFileByPath(path);
if (!(file instanceof TFile)) {
throw new Error(`Vault file not found: ${path}`);
}
return this.app.vault.read(file);
},
},
this.app,
);
const switcherPanel = root.createDiv({ cls: 'github-copilot-chat-switcher-panel' });
this.switcher = switcherPanel.createEl('select', { cls: 'github-copilot-chat-switcher' });
const newButton = switcherPanel.createEl('button', { text: 'New', cls: 'github-copilot-chat-new' });
const messagesPanel = root.createDiv({ cls: 'github-copilot-chat-message-panel' });
const inputPanel = root.createDiv({ cls: 'github-copilot-chat-input-panel' });
this.messageList = new MessageList(messagesPanel, this, this.app);
this.inputBar = new InputBar(inputPanel, this, this.app, {
onSubmit: (text, attachedFiles) => {
void this.viewModel?.sendUserMessage(text, attachedFiles);
},
onStop: () => this.viewModel?.stopGeneration(),
});
this.registerDomEvent(this.switcher, 'change', () => {
if (this.switcher?.value) {
this.viewModel?.selectConversation(this.switcher.value);
}
});
this.registerDomEvent(newButton, 'click', () => this.viewModel?.newConversation());
this.render();
}

async onClose(): Promise<void> {
this.viewModel?.stopGeneration();
this.contentEl.empty();
}

private render(): void {
if (!this.viewModel || !this.switcher) {
return;
}
this.switcher.empty();
for (const conversation of this.viewModel.allConversations) {
const option = this.switcher.createEl('option', { text: conversation.title, value: conversation.id });
option.selected = conversation.id === this.viewModel.currentConversation.id;
}
this.messageList?.render(this.viewModel.currentConversation.messages, this.viewModel.runState);
this.inputBar?.render(this.viewModel.runState === 'streaming');
}

private openConsent(toolCall: ToolCall): Promise<ConsentDecision> {
return new Promise((resolve) => {
new ConsentModal(this.app, toolCall, resolve).open();
});
}
}

export async function openChatView(leafProvider: { getRightLeaf(create: boolean): WorkspaceLeaf | null }): Promise<void> {
const leaf = leafProvider.getRightLeaf(false) ?? leafProvider.getRightLeaf(true);
await leaf?.setViewState({ type: CHAT_VIEW_TYPE, active: true });
}
