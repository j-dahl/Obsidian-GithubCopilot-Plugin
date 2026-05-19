import 'openai/shims/node';
/* global describe, expect, test */
import { AzureFoundryProvider, ProviderError, type ChatCompletionChunk } from '../../src/providers';
import {
	completionResponse,
	createJsonFetch,
	createStreamingFetch,
	streamingResponse,
} from './helpers';

describe('AzureFoundryProvider', () => {
	test('uses Azure OpenAI v1 endpoint with deployment as model', async () => {
		const fetcher = createJsonFetch(completionResponse('chat-prod'));
		const provider = new AzureFoundryProvider({
			endpoint: 'https://example.openai.azure.com/openai/v1/',
			apiKey: 'azure-key',
			deployment: 'chat-prod',
			fetcher,
		});

		await provider.complete({
			messages: [{ role: 'user', content: 'hi' }],
			tools: [
				{
					type: 'function',
					function: { name: 'vault_search', parameters: { type: 'object' } },
				},
			],
		});

		const request = fetcher.requests[0];
		expect(request?.url).toBe(
			'https://example.openai.azure.com/openai/v1/chat/completions',
		);
		expect(request?.headers.get('authorization')).toBe('Bearer azure-key');
		expect(request?.body).toMatchObject({
			model: 'chat-prod',
			tools: [{ function: { name: 'vault_search' } }],
		});
	});

	test('maps Azure Foundry HTTP errors', async () => {
		const provider = new AzureFoundryProvider({
			endpoint: 'https://example.openai.azure.com/openai/v1/',
			apiKey: 'azure-key',
			deployment: 'chat-prod',
			fetcher: createJsonFetch({ error: { message: 'bad' } }, 429),
		});

		await expect(
			provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
		).rejects.toMatchObject<Partial<ProviderError>>({ code: 'azure_foundry_error' });
	});

	test('streams Azure Foundry chunks', async () => {
		const provider = new AzureFoundryProvider({
			endpoint: 'https://example.openai.azure.com/openai/v1/',
			apiKey: 'azure-key',
			deployment: 'chat-prod',
			fetcher: createStreamingFetch(streamingResponse('chat-prod')),
		});

		const chunks: ChatCompletionChunk[] = [];
		for await (const chunk of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.delta.content).toBe('hel');
	});
});
