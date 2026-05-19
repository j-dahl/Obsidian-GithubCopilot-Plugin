/* global AsyncGenerator */
import OpenAI from 'openai';
import type {
	ChatCompletion,
	ChatCompletionAssistantMessageParam,
	ChatCompletionChunk as OpenAIChatCompletionChunk,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageToolCall,
	ChatCompletionMessageParam,
	ChatCompletionTool as OpenAIChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { CompletionUsage } from 'openai/resources/completions';
import type {
	ChatCompletionChunk,
	ChatCompletionOptions,
	ChatCompletionResult,
	ChatCompletionTool,
	ChatCompletionToolCall,
	ChatMessage,
	ChatUsage,
	ProviderPingResult,
} from './types';
import { ProviderError } from './types';

export type FetchLike = typeof fetch;

export interface OpenAIProviderConfig {
	client: OpenAI;
	defaultModel: string;
	errorCode: string;
}

export function toProviderError(error: unknown, code: string): ProviderError {
	if (error instanceof ProviderError) {
		return error;
	}
	const httpStatus =
		typeof (error as { status?: unknown }).status === 'number'
			? (error as { status: number }).status
			: undefined;
	if (error instanceof Error) {
		return new ProviderError(code, error.message, error, httpStatus);
	}
	return new ProviderError(code, 'Provider request failed', error, httpStatus);
}

export function requireString(value: unknown, field: string): string {
	if (typeof value === 'string' && value.trim().length > 0) {
		return value;
	}
	throw new ProviderError('missing_config', `Missing required provider field: ${field}`);
}

export function normalizeEndpoint(endpoint: string): string {
	return endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
}

function mapTool(tool: ChatCompletionTool): OpenAIChatCompletionTool {
	return {
		type: tool.type,
		function: {
			name: tool.function.name,
			description: tool.function.description,
			parameters: tool.function.parameters,
		},
	};
}

function mapMessage(message: ChatMessage): ChatCompletionMessageParam {
	if (message.role === 'tool') {
		return {
			role: 'tool',
			content: message.content ?? '',
			tool_call_id: requireString(message.tool_call_id, 'tool_call_id'),
		};
	}
	if (message.role === 'assistant') {
		const assistant: ChatCompletionAssistantMessageParam = {
			role: 'assistant',
			content: message.content,
		};
		if (message.tool_calls !== undefined) {
			assistant.tool_calls = message.tool_calls.map((toolCall) => ({
				id: toolCall.id,
				type: toolCall.type,
				function: {
					name: toolCall.function.name,
					arguments: toolCall.function.arguments,
				},
			}));
		}
		return assistant;
	}
	return {
		role: message.role,
		content: message.content ?? '',
	};
}

function mapToolCall(
	toolCall: ChatCompletionMessageToolCall,
	index?: number,
): ChatCompletionToolCall {
	return {
		id: toolCall.id,
		type: 'function',
		index,
		function: {
			name: toolCall.function.name,
			arguments: toolCall.function.arguments,
		},
	};
}

function mapUsage(usage: CompletionUsage | undefined): ChatUsage | undefined {
	if (usage === undefined) {
		return undefined;
	}
	return {
		promptTokens: usage.prompt_tokens,
		completionTokens: usage.completion_tokens,
		totalTokens: usage.total_tokens,
	};
}

function mapCompletion(completion: ChatCompletion): ChatCompletionResult {
	const choice = completion.choices[0];
	if (choice === undefined) {
		throw new ProviderError('empty_response', 'Provider returned no choices');
	}
	const message = choice.message;
	return {
		id: completion.id,
		model: completion.model,
		message: {
			role: 'assistant',
			content: message.content ?? null,
			tool_calls: message.tool_calls?.map((toolCall, index) => mapToolCall(toolCall, index)),
		},
		finishReason: choice.finish_reason,
		usage: mapUsage(completion.usage),
	};
}

function mapChunk(chunk: OpenAIChatCompletionChunk): ChatCompletionChunk {
	const choice = chunk.choices[0];
	const delta = choice?.delta;
	const role =
		delta?.role === 'system' ||
		delta?.role === 'user' ||
		delta?.role === 'assistant' ||
		delta?.role === 'tool'
			? delta.role
			: undefined;
	return {
		id: chunk.id,
		model: chunk.model,
		delta: {
			role,
			content: delta?.content ?? undefined,
			tool_calls: delta?.tool_calls?.map((toolCall) => ({
				id: toolCall.id ?? '',
				type: 'function',
				index: toolCall.index,
				function: {
					name: toolCall.function?.name ?? '',
					arguments: toolCall.function?.arguments ?? '',
				},
			})),
		},
		finishReason: choice?.finish_reason ?? null,
	};
}

function buildParams(
	opts: ChatCompletionOptions,
	defaultModel: string,
	stream: false,
): ChatCompletionCreateParamsNonStreaming;
function buildParams(
	opts: ChatCompletionOptions,
	defaultModel: string,
	stream: true,
): ChatCompletionCreateParamsStreaming;
function buildParams(
	opts: ChatCompletionOptions,
	defaultModel: string,
	stream: boolean,
): ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming {
	const common = {
		model: opts.model ?? defaultModel,
		messages: opts.messages.map(mapMessage),
		tools: opts.tools?.map(mapTool),
		max_tokens: opts.maxTokens,
		temperature: opts.temperature,
	};
	if (stream) {
		return { ...common, stream: true };
	}
	return { ...common, stream: false };
}

function createLinkedAbortController(signal: AbortSignal | undefined): {
	controller: AbortController;
	removeListener: () => void;
} {
	const controller = new AbortController();
	if (signal === undefined) {
		return { controller, removeListener: () => undefined };
	}
	if (signal.aborted) {
		controller.abort(signal.reason);
		return { controller, removeListener: () => undefined };
	}
	const abort = (): void => controller.abort(signal.reason);
	signal.addEventListener('abort', abort, { once: true });
	return { controller, removeListener: () => signal.removeEventListener('abort', abort) };
}

export class OpenAIChatCompletionProviderBase {
	private readonly client: OpenAI;
	private readonly defaultModel: string;
	private readonly errorCode: string;

	constructor(config: OpenAIProviderConfig) {
		this.client = config.client;
		this.defaultModel = config.defaultModel;
		this.errorCode = config.errorCode;
	}

	async complete(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
		try {
			const completion = await this.client.chat.completions.create(
				buildParams(opts, this.defaultModel, false),
				{ signal: opts.signal },
			);
			return mapCompletion(completion);
		} catch (error: unknown) {
			throw toProviderError(error, this.errorCode);
		}
	}

	async *stream(opts: ChatCompletionOptions): AsyncGenerator<ChatCompletionChunk> {
		const linked = createLinkedAbortController(opts.signal);
		try {
			const stream = await this.client.chat.completions.create(
				buildParams(opts, this.defaultModel, true),
				{ signal: linked.controller.signal },
			);
			for await (const chunk of stream) {
				yield mapChunk(chunk);
			}
		} catch (error: unknown) {
			throw toProviderError(error, this.errorCode);
		} finally {
			linked.removeListener();
			if (!linked.controller.signal.aborted) {
				linked.controller.abort();
			}
		}
	}

	async ping(): Promise<ProviderPingResult> {
		const started = Date.now();
		try {
			await this.complete({
				model: this.defaultModel,
				messages: [{ role: 'user', content: 'ping' }],
				maxTokens: 1,
			});
			return { ok: true, latencyMs: Date.now() - started, httpStatus: 200 };
		} catch (error: unknown) {
			throw toProviderError(error, this.errorCode);
		}
	}
}
