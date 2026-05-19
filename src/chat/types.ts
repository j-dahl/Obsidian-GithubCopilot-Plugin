/* global AsyncIterable */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type AgentRunState = 'idle' | 'streaming' | 'awaiting-consent' | 'tool-running' | 'error';

export type ToolCallStatus = 'pending' | 'awaiting-consent' | 'running' | 'success' | 'error' | 'aborted';

export interface ToolAnnotations {
readOnlyHint?: boolean;
destructiveHint?: boolean;
openWorldHint?: boolean;
[key: string]: boolean | string | number | undefined;
}

export interface ToolCall {
id: string;
name: string;
serverName: string;
arguments: Record<string, unknown>;
status: ToolCallStatus;
annotations?: ToolAnnotations;
result?: string;
error?: string;
}

export interface ChatMessage {
id: string;
role: ChatRole;
content: string;
timestamp: number;
toolCallId?: string;
toolCalls?: ToolCall[];
}

export interface Conversation {
id: string;
title: string;
messages: ChatMessage[];
createdAt: number;
updatedAt: number;
}

export type ConsentDecision = 'allow-once' | 'allow-session' | 'deny-once' | 'deny-always' | 'abort';

export interface ConsentRequest {
toolCall: ToolCall;
decisionFn: (decision: ConsentDecision) => void;
}

export interface OpenAITool {
type: 'function';
function: {
name: string;
description?: string;
parameters?: Record<string, unknown>;
};
serverName?: string;
annotations?: ToolAnnotations;
}

export interface ProviderMessage {
role: ChatRole;
content: string;
tool_call_id?: string;
tool_calls?: ToolCall[];
}

export interface StreamChunk {
content?: string;
toolCalls?: ToolCall[];
}

export interface ChatCompletionProvider {
stream(request: { messages: ProviderMessage[]; tools: OpenAITool[]; signal: AbortSignal }): AsyncIterable<StreamChunk>;
}

export interface ToolDefinition {
name: string;
description: string;
inputSchema: Record<string, unknown>;
annotations?: ToolAnnotations;
}

export interface CallToolResult {
content: Array<{ type: 'text'; text: string }>;
isError?: boolean;
}

export type NativeToolHandler = (args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult>;

export interface NativeToolRegistration {
serverName: 'obsidian-native';
tool: ToolDefinition;
handler: NativeToolHandler;
}

export type PermissionDecision =
| { action: 'auto-allow' }
| { action: 'ask'; reason?: string }
| { action: 'deny'; reason: string };

export interface PermissionGateLike {
evaluate(toolCall: ToolCall, signal: AbortSignal): Promise<PermissionDecision> | PermissionDecision;
}

export interface ToolDispatcherLike {
callTool(serverName: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult>;
registerLocalTools?(serverName: string, tools: NativeToolRegistration[]): void;
}

export interface McpRegistryLike {
toOpenAITools(): OpenAITool[];
}

export interface AuditLoggerLike {
logToolCall(entry: { toolCall: ToolCall; decision: string; result?: CallToolResult; error?: string; timestamp: number }): Promise<void> | void;
}

export interface TrustedContentLike {
wrapForLlm(path: string, content: string): string;
}

export interface ChatSettingsLike {
mcpServers?: Record<string, { disabledTools?: string[] }> | Array<{ id?: string; name?: string; disabledTools?: string[] }>;
}

export interface ChatPluginContext {
provider: ChatCompletionProvider;
mcpRegistry: McpRegistryLike;
dispatcher: ToolDispatcherLike;
permissionGate: PermissionGateLike;
auditLogger: AuditLoggerLike;
trustedContent: TrustedContentLike;
settings: ChatSettingsLike;
systemPrompt: string;
}
