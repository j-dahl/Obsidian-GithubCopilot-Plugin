import 'openai/shims/node';
/* global describe, expect, test */
import {
	AzureFoundryProvider,
	AzureOpenAIClassicProvider,
	GitHubCopilotProvider,
	GitHubModelsProvider,
	ProviderError,
	createProvider,
	type CopilotSessionTokenStore,
} from '../../src/providers';
import { createJsonFetch } from './helpers';

const deps = {
	obsidianVersion: '1.8.0',
	pluginVersion: '0.1.0',
	sessionTokenStore: {
		async getValidSessionToken(): Promise<{ token: string; baseUrl: string }> {
			return { token: 'tid=session', baseUrl: 'https://api.githubcopilot.com' };
		},
	} satisfies CopilotSessionTokenStore,
};

describe('createProvider', () => {
	test('constructs GitHub Models provider', () => {
		const provider = createProvider(
			{ backend: 'github-models', token: 'ghp_test', fetcher: createJsonFetch({}) },
			deps,
		);
		expect(provider).toBeInstanceOf(GitHubModelsProvider);
	});

	test('constructs GitHub Copilot provider', () => {
		const provider = createProvider(
			{ backend: 'github-copilot', model: 'gpt-4.1', fetcher: createJsonFetch({}) },
			deps,
		);
		expect(provider).toBeInstanceOf(GitHubCopilotProvider);
	});

	test('constructs Azure Foundry provider', () => {
		const provider = createProvider(
			{
				backend: 'azure-foundry',
				endpoint: 'https://example.openai.azure.com/openai/v1/',
				apiKey: 'key',
				deployment: 'chat',
				fetcher: createJsonFetch({}),
			},
			deps,
		);
		expect(provider).toBeInstanceOf(AzureFoundryProvider);
	});

	test('constructs Azure OpenAI Classic provider', () => {
		const provider = createProvider(
			{
				backend: 'azure-openai-classic',
				resourceEndpoint: 'https://classic.openai.azure.com',
				apiKey: 'key',
				deployment: 'chat',
				fetcher: createJsonFetch({}),
			},
			deps,
		);
		expect(provider).toBeInstanceOf(AzureOpenAIClassicProvider);
	});

	test('throws ProviderError for missing config', () => {
		expect(() =>
			createProvider({ backend: 'github-models', fetcher: createJsonFetch({}) }, deps),
		).toThrow(ProviderError);
		expect(() =>
			createProvider(
				{ backend: 'github-copilot', model: 'gpt-4.1', fetcher: createJsonFetch({}) },
				{ obsidianVersion: '1.8.0', pluginVersion: '0.1.0' },
			),
		).toThrow(ProviderError);
	});
});
