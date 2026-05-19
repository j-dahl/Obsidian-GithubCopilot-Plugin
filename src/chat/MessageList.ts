import { MarkdownRenderer, type App, type Component } from 'obsidian';
import type { AgentRunState, ChatMessage } from './types';
import { ToolMessage } from './ToolMessage';

export class MessageList {
private readonly container: HTMLElement;
private readonly component: Component;
private readonly app: App;
private renderedMessageCount = 0;
private lastContent = '';

constructor(container: HTMLElement, component: Component, app: App) {
this.container = container;
this.component = component;
this.app = app;
this.container.addClass('github-copilot-chat-messages');
}

render(messages: ChatMessage[], runState: AgentRunState): void {
const contentKey = messages.map((message) => `${message.id}:${message.content}:${message.toolCalls?.map((tool) => `${tool.id}:${tool.status}:${tool.result ?? tool.error ?? ''}`).join('|') ?? ''}`).join('~');
if (messages.length === this.renderedMessageCount && contentKey === this.lastContent) {
return;
}
this.renderedMessageCount = messages.length;
this.lastContent = contentKey;
this.container.empty();
for (const message of messages) {
this.renderMessage(message);
}
if (runState === 'streaming') {
this.container.createDiv({ cls: 'github-copilot-chat-streaming', text: 'Thinking…' });
}
this.container.scrollTop = this.container.scrollHeight;
}

private renderMessage(message: ChatMessage): void {
const row = this.container.createDiv({ cls: `github-copilot-chat-row github-copilot-chat-row-${message.role}` });
const bubble = row.createDiv({ cls: `github-copilot-chat-bubble github-copilot-chat-bubble-${message.role}` });
if (message.role === 'assistant') {
void MarkdownRenderer.render(this.app, message.content, bubble, '', this.component);
} else if (message.role === 'tool') {
if (message.toolCalls) {
for (const toolCall of message.toolCalls) {
new ToolMessage(bubble, toolCall, this.app).render();
}
} else {
bubble.setText(message.content);
}
} else {
bubble.setText(message.content);
}
}
}
