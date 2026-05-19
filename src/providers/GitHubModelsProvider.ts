/* global AsyncGenerator */
import OpenAI from 'openai';
import { fetchCatalog, getModels } from './catalog';
import {
	FetchLike,
	OpenAIChatCompletionProviderBase,
	requireString,
} from './openaiAdapter';
import type {
	ChatCompletionOptions,
	ChatCompletionProvider,
	ChatCompletionResult,
	ChatCompletionChunk,
	ModelInfo,
} from './types';

export interface GitHubModelsProviderConfig {
	token: string;
	model?: string;
	vaultPath?: string;
	fetcher?: FetchLike;
}

export class GitHubModelsProvider implements ChatCompletionProvider {
	readonly id = 'github-models';
	readonly displayName = 'GitHub Models';
	readonly supportsTools = true;
	private readonly base: OpenAIChatCompletionProviderBase;
	private readonly vaultPath: string | undefined;
	private readonly fetcher: FetchLike | undefined;

	constructor(config: GitHubModelsProviderConfig) {
		const token = requireString(config.token, 'token');
		this.vaultPath = config.vaultPath;
		this.fetcher = config.fetcher;
		this.base = new OpenAIChatCompletionProviderBase({
			defaultModel: config.model ?? 'openai/gpt-4.1',
			errorCode: 'github_models_error',
			client: new OpenAI({
				apiKey: token,
				dangerouslyAllowBrowser: true,
				baseURL: 'https://models.github.ai/inference',
				defaultHeaders: {
					'X-GitHub-Api-Version': '2026-03-10',
					Accept: 'application/vnd.github+json',
				},
				fetch: config.fetcher,
			}),
		});
	}

	complete(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
		return this.base.complete(opts);
	}

	stream(opts: ChatCompletionOptions): AsyncGenerator<ChatCompletionChunk> {
		return this.base.stream(opts);
	}

	async listModels(): Promise<ModelInfo[]> {
		if (this.vaultPath === undefined) {
			return [];
		}
		return getModels(this.vaultPath, this.fetcher);
	}

	ping(): Promise<boolean> {
		return this.base.ping();
	}
}

export { fetchCatalog };
