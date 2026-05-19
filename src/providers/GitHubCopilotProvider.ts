/* global AsyncGenerator */
import OpenAI from 'openai';
import {
	FetchLike,
	OpenAIChatCompletionProviderBase,
	normalizeEndpoint,
	requireString,
} from './openaiAdapter';
import type {
	ChatCompletionOptions,
	ChatCompletionProvider,
	ChatCompletionResult,
	ChatCompletionChunk,
} from './types';

export interface CopilotSessionTokenStore {
	getValidSessionToken(): Promise<{ token: string; baseUrl: string }>;
}

export interface GitHubCopilotProviderConfig {
	model: string;
	sessionTokenStore: CopilotSessionTokenStore;
	obsidianVersion: string;
	pluginVersion: string;
	fetcher?: FetchLike;
}

export class GitHubCopilotProvider implements ChatCompletionProvider {
	readonly id = 'github-copilot';
	readonly displayName = 'GitHub Copilot';
	readonly supportsTools = true;
	private readonly config: GitHubCopilotProviderConfig;

	constructor(config: GitHubCopilotProviderConfig) {
		requireString(config.model, 'model');
		requireString(config.obsidianVersion, 'obsidianVersion');
		requireString(config.pluginVersion, 'pluginVersion');
		this.config = config;
	}

	private async createBase(): Promise<OpenAIChatCompletionProviderBase> {
		const session = await this.config.sessionTokenStore.getValidSessionToken();
		const token = requireString(session.token, 'sessionToken');
		const baseUrl = requireString(session.baseUrl, 'baseUrl');
		return new OpenAIChatCompletionProviderBase({
			defaultModel: this.config.model,
			errorCode: 'github_copilot_error',
			client: new OpenAI({
				apiKey: token,
				dangerouslyAllowBrowser: true,
				baseURL: normalizeEndpoint(baseUrl),
				defaultHeaders: {
					'Copilot-Integration-Id': 'vscode-chat',
					'Editor-Version': `obsidian/${this.config.obsidianVersion}`,
					'Editor-Plugin-Version': `github-copilot-agent/${this.config.pluginVersion}`,
					'Openai-Intent': 'conversation-edits',
					'User-Agent': 'GitHubCopilotChat/0.26.7',
				},
				fetch: this.config.fetcher,
			}),
		});
	}

	async complete(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
		const base = await this.createBase();
		return base.complete(opts);
	}

	async *stream(opts: ChatCompletionOptions): AsyncGenerator<ChatCompletionChunk> {
		const base = await this.createBase();
		yield* base.stream(opts);
	}

	async ping(): Promise<boolean> {
		const base = await this.createBase();
		return base.ping();
	}
}
