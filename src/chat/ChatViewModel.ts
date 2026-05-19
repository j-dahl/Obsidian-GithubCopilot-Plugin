import type { App } from 'obsidian';
import { Buffer } from 'node:buffer';
import type { ChatMessage, ChatPluginContext, ChatConsentDecision, Conversation, OpenAITool, ProviderMessage, ToolCall } from './types';
import { createNativeTools } from './nativeTools';
import { validateVaultRelativePath } from './pathValidation';

export interface ChatViewModelEvents {
onChange?: () => void;
onConsent: (toolCall: ToolCall) => Promise<ChatConsentDecision>;
readVaultFile?: (path: string, signal: AbortSignal) => Promise<string>;
}

export class ChatViewModel {
private readonly context: ChatPluginContext;
private readonly events: ChatViewModelEvents;
private abortController: AbortController | null = null;
private activeRun = 0;
private conversations: Conversation[];
private currentConversationId: string;
private readonly sessionAllowedTools = new Map<string, Set<string>>();
runState: 'idle' | 'streaming' | 'awaiting-consent' | 'tool-running' | 'error' = 'idle';
lastErrorCode: string | null = null;

constructor(context: ChatPluginContext, events: ChatViewModelEvents, app?: App) {
if (!events.onConsent) {
throw new Error('ChatViewModel requires an onConsent callback.');
}
this.context = context;
this.events = events;
const conversation = this.createConversation();
this.conversations = [conversation];
this.currentConversationId = conversation.id;
if (app && this.context.dispatcher.registerLocalTools) {
this.context.dispatcher.registerLocalTools('obsidian-native', createNativeTools(app));
}
}

get currentConversation(): Conversation {
const conversation = this.conversations.find((item) => item.id === this.currentConversationId);
if (!conversation) {
throw new Error('Current conversation is missing.');
}
return conversation;
}

get allConversations(): Conversation[] {
return [...this.conversations];
}

newConversation(): void {
const conversation = this.createConversation();
this.conversations = [conversation, ...this.conversations];
this.currentConversationId = conversation.id;
this.emitChange();
}

selectConversation(id: string): void {
if (this.conversations.some((conversation) => conversation.id === id)) {
this.currentConversationId = id;
this.emitChange();
}
}

async sendUserMessage(text: string, attachedFiles: string[]): Promise<void> {
const trimmed = text.trim();
if (!trimmed && attachedFiles.length === 0) {
return;
}
this.stopGeneration();
this.lastErrorCode = null;
const runId = ++this.activeRun;
this.abortController = new AbortController();
const signal = this.abortController.signal;
const contextText = await this.buildAttachedFileContext(attachedFiles, signal);
this.addMessage({ id: this.id(), role: 'user', content: [trimmed, contextText].filter((part) => part.length > 0).join('\n\n'), timestamp: Date.now() });
await this.runAgentLoop(runId, signal, 0);
}

async regenerate(): Promise<void> {
const conversation = this.currentConversation;
const lastAssistant = conversation.messages.findLastIndex((message) => message.role === 'assistant');
if (lastAssistant >= 0) {
conversation.messages.splice(lastAssistant, 1);
conversation.updatedAt = Date.now();
this.emitChange();
this.stopGeneration();
const runId = ++this.activeRun;
this.abortController = new AbortController();
await this.runAgentLoop(runId, this.abortController.signal, 0);
}
}

stopGeneration(): void {
if (this.abortController && !this.abortController.signal.aborted) {
this.abortController.abort();
}
if (this.runState === 'streaming' || this.runState === 'tool-running' || this.runState === 'awaiting-consent') {
this.runState = 'idle';
this.emitChange();
}
}

clearConversation(): void {
this.currentConversation.messages = [];
this.sessionAllowedTools.delete(this.currentConversation.id);
this.currentConversation.updatedAt = Date.now();
this.runState = 'idle';
this.emitChange();
}

private async runAgentLoop(runId: number, signal: AbortSignal, depth: number): Promise<void> {
if (depth >= 10) {
this.addMessage({ id: this.id(), role: 'tool', content: 'Recursion cap hit after 10 tool iterations.', timestamp: Date.now() });
this.runState = 'error';
this.emitChange();
return;
}
this.runState = 'streaming';
this.emitChange();
const assistant: ChatMessage = { id: this.id(), role: 'assistant', content: '', timestamp: Date.now() };
this.currentConversation.messages.push(assistant);
let toolCalls: ToolCall[] = [];
try {
for await (const chunk of this.context.provider.stream({ messages: this.buildProviderMessages(), tools: this.buildTools(), signal })) {
if (signal.aborted || runId !== this.activeRun) {
return;
}
if (chunk.content) {
assistant.content += chunk.content;
assistant.timestamp = Date.now();
this.currentConversation.updatedAt = Date.now();
this.emitChange();
}
if (chunk.toolCalls) {
toolCalls = [...toolCalls, ...chunk.toolCalls];
}
}
} catch (error) {
if (signal.aborted) {
return;
}
this.lastErrorCode = this.errorCode(error);
assistant.content += `\n\nError: ${this.errorMessage(error)}`;
this.runState = 'error';
this.emitChange();
return;
}
if (toolCalls.length === 0) {
this.runState = 'idle';
this.emitChange();
return;
}
await this.resolveToolCalls(toolCalls, signal);
if (!signal.aborted && runId === this.activeRun) {
await this.runAgentLoop(runId, signal, depth + 1);
}
}

private async resolveToolCalls(toolCalls: ToolCall[], signal: AbortSignal): Promise<void> {
for (const toolCall of toolCalls) {
if (signal.aborted) {
return;
}
const decision = await this.context.permissionGate.evaluate(toolCall, signal);
if (decision.action === 'deny') {
const denied: ToolCall = { ...toolCall, status: 'aborted', result: `Denied by policy: ${decision.reason}` };
this.addToolMessage(denied);
await this.context.auditLogger.logToolCall({ toolCall: denied, decision: 'deny', timestamp: Date.now() });
continue;
}
let auditDecision: string = decision.action;
if (decision.action === 'ask') {
this.runState = 'awaiting-consent';
this.addToolMessage({ ...toolCall, status: 'awaiting-consent' });
this.emitChange();
const consent = await this.requestConsent(toolCall);
auditDecision = consent;
if (consent.startsWith('deny') || consent === 'abort') {
const denied: ToolCall = { ...toolCall, status: 'aborted', result: `Denied by user: ${consent}` };
this.addToolMessage(denied);
await this.context.auditLogger.logToolCall({ toolCall: denied, decision: consent, timestamp: Date.now() });
continue;
}
if (consent === 'allow-session') {
this.allowedForCurrentConversation().add(this.qualifiedName(toolCall));
}
}
this.runState = 'tool-running';
this.addToolMessage({ ...toolCall, status: 'running' });
this.emitChange();
try {
const result = await this.context.dispatcher.callTool(toolCall.serverName, toolCall.name, toolCall.arguments, signal);
const resultText = result.content.map((item) => item.text).join('\n');
const completed: ToolCall = { ...toolCall, status: result.isError ? 'error' : 'success', result: resultText };
this.addToolMessage(completed);
await this.context.auditLogger.logToolCall({ toolCall: completed, decision: auditDecision, result, timestamp: Date.now() });
} catch (error) {
const failed: ToolCall = { ...toolCall, status: 'error', error: this.errorMessage(error) };
this.addToolMessage(failed);
await this.context.auditLogger.logToolCall({ toolCall: failed, decision: auditDecision, error: failed.error, timestamp: Date.now() });
}
}
}

private requestConsent(toolCall: ToolCall): Promise<ChatConsentDecision> {
if (this.allowedForCurrentConversation().has(this.qualifiedName(toolCall))) {
return Promise.resolve('allow-session');
}
return this.events.onConsent(toolCall);
}

private buildProviderMessages(): ProviderMessage[] {
return [
{ role: 'system', content: this.context.systemPrompt },
...this.currentConversation.messages.map((message) => ({ role: message.role, content: message.llmContent ?? message.content, tool_call_id: message.toolCallId, tool_calls: message.toolCalls })),
];
}

private buildTools(): OpenAITool[] {
const nativeTools = createNativeToolsFacade();
return [...nativeTools, ...this.context.mcpRegistry.toOpenAITools()].filter((tool) => {
const serverName = tool.serverName ?? 'obsidian-native';
return !this.disabledToolsFor(serverName).includes(tool.function.name);
});
}

private disabledToolsFor(serverName: string): string[] {
const servers = this.context.settings.mcpServers;
if (!servers) {
return [];
}
if (Array.isArray(servers)) {
return servers.find((server) => server.id === serverName || server.name === serverName)?.disabledTools ?? [];
}
return servers[serverName]?.disabledTools ?? [];
}

private async buildAttachedFileContext(attachedFiles: string[], signal: AbortSignal): Promise<string> {
const blocks: string[] = [];
for (const path of attachedFiles) {
if (signal.aborted) {
throw new DOMException('Operation aborted', 'AbortError');
}
const content = this.events.readVaultFile ? await this.events.readVaultFile(validateVaultRelativePath(path), signal) : '';
blocks.push(`<file path="${escapeAttribute(path)}"/>\n${this.context.trustedContent.wrapForLlm(path, content)}`);
}
return blocks.join('\n\n');
}

private addToolMessage(toolCall: ToolCall): void {
const content = toolCall.result ?? toolCall.error ?? '';
const llmContent = toolCall.result === undefined ? content : wrapToolResult(toolCall, toolCall.result);
this.addMessage({ id: this.id(), role: 'tool', content, llmContent, timestamp: Date.now(), toolCallId: toolCall.id, toolCalls: [toolCall] });
}

private addMessage(message: ChatMessage): void {
this.currentConversation.messages.push(message);
this.currentConversation.updatedAt = Date.now();
if (message.role === 'user' && this.currentConversation.title === 'New chat') {
this.currentConversation.title = message.content.slice(0, 48) || 'New chat';
}
this.emitChange();
}

private createConversation(): Conversation {
const now = Date.now();
return { id: this.id(), title: 'New chat', messages: [], createdAt: now, updatedAt: now };
}

private id(): string {
return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

private emitChange(): void {
this.events.onChange?.();
}

private allowedForCurrentConversation(): Set<string> {
const id = this.currentConversation.id;
let allowed = this.sessionAllowedTools.get(id);
if (!allowed) {
allowed = new Set<string>();
this.sessionAllowedTools.set(id, allowed);
}
return allowed;
}

private qualifiedName(toolCall: ToolCall): string {
return `${toolCall.serverName}__${toolCall.name}`;
}

private errorMessage(error: unknown): string {
return error instanceof Error ? error.message : String(error);
}

private errorCode(error: unknown): string | null {
const code = (error as { code?: unknown })?.code;
return typeof code === 'string' ? code : null;
}
}

function wrapToolResult(toolCall: ToolCall, result: string): string {
return `<untrusted-tool-result server="${escapeAttribute(toolCall.serverName)}" tool="${escapeAttribute(toolCall.name)}" encoding="base64">\n${Buffer.from(result, 'utf8').toString('base64')}\n</untrusted-tool-result>`;
}

function escapeAttribute(value: string): string {
return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function createNativeToolsFacade(): OpenAITool[] {
	const tools: Array<{ name: string; description: string; annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } }> = [
		{ name: 'read_active_file', description: 'Read the active file', annotations: { readOnlyHint: true } },
		{ name: 'read_vault_file', description: 'Read a vault file', annotations: { readOnlyHint: true } },
		{ name: 'get_active_selection', description: 'Get active selection', annotations: { readOnlyHint: true } },
		{ name: 'search_vault', description: 'Search vault', annotations: { readOnlyHint: true } },
		{ name: 'list_vault_files', description: 'List vault files', annotations: { readOnlyHint: true } },
		{ name: 'create_note', description: 'Create note', annotations: { readOnlyHint: false, destructiveHint: false } },
		{ name: 'append_note', description: 'Append note', annotations: { readOnlyHint: false, destructiveHint: false } },
		{ name: 'delete_note', description: 'Delete note', annotations: { readOnlyHint: false, destructiveHint: true } },
	];
	return tools.map((tool) => ({
		type: 'function',
		serverName: 'obsidian-native',
		function: { name: tool.name, description: tool.description, parameters: { type: 'object' } },
		annotations: tool.annotations,
	}));
}
