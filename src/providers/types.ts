/* global AsyncGenerator */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatCompletionToolCall {
	id: string;
	type: 'function';
	index?: number;
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatMessage {
	role: ChatRole;
	content: string | null;
	tool_call_id?: string;
	tool_calls?: ChatCompletionToolCall[];
}

export interface ChatCompletionTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters: Record<string, unknown>;
	};
}

export interface ChatCompletionOptions {
	model?: string;
	messages: ChatMessage[];
	tools?: ChatCompletionTool[];
	maxTokens?: number;
	temperature?: number;
	stream?: boolean;
	signal?: AbortSignal;
}

export interface ChatUsage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
}

export interface ChatCompletionResult {
	id: string;
	model: string;
	message: ChatMessage;
	finishReason: string | null;
	usage?: ChatUsage;
}

export interface ChatCompletionChunk {
	id: string;
	model: string;
	delta: Partial<ChatMessage>;
	finishReason: string | null;
}

export interface ModelInfo {
	id: string;
	name: string;
	publisher: string;
	supportsTools: boolean;
	supportsStreaming: boolean;
	maxInputTokens?: number;
	rateLimitTier?: string;
	inputModalities: string[];
}

export class ProviderError extends Error {
	readonly code: string;
	readonly cause?: unknown;

	constructor(code: string, message: string, cause?: unknown) {
		super(message);
		this.name = 'ProviderError';
		this.code = code;
		this.cause = cause;
	}
}

export interface ChatCompletionProvider {
	readonly id: string;
	readonly displayName: string;
	readonly supportsTools: boolean;
	complete(opts: ChatCompletionOptions): Promise<ChatCompletionResult>;
	stream(opts: ChatCompletionOptions): AsyncGenerator<ChatCompletionChunk>;
	listModels?(): Promise<ModelInfo[]>;
	ping(): Promise<boolean>;
}
