import 'openai/shims/node';
/* global describe, expect, test */
import {
	AzureOpenAIClassicProvider,
	ProviderError,
	type ChatCompletionChunk,
} from '../../src/providers';
import {
	completionResponse,
	createJsonFetch,
	createStreamingFetch,
	streamingResponse,
} from './helpers';

describe('AzureOpenAIClassicProvider', () => {
	test('uses deployment endpoint, api-version query, and api-key header', async () => {
		const fetcher = createJsonFetch(completionResponse('ignored-by-classic'));
		const provider = new AzureOpenAIClassicProvider({
			resourceEndpoint: 'https://classic.openai.azure.com',
			apiKey: 'classic-key',
			deployment: 'legacy-chat',
			fetcher,
		});

		await provider.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 7 });

		const request = fetcher.requests[0];
		expect(request?.url).toBe(
			'https://classic.openai.azure.com/openai/deployments/legacy-chat/chat/completions?api-version=2024-10-21',
		);
		expect(request?.headers.get('api-key')).toBe('classic-key');
		expect(request?.headers.get('authorization')).toBe('Bearer placeholder');
		expect(request?.body).toMatchObject({ model: 'legacy-chat', max_tokens: 7 });
	});

	test('maps Azure OpenAI Classic errors', async () => {
		const provider = new AzureOpenAIClassicProvider({
			resourceEndpoint: 'https://classic.openai.azure.com',
			apiKey: 'classic-key',
			deployment: 'legacy-chat',
			fetcher: createJsonFetch({ error: { message: 'bad' } }, 400),
		});

		await expect(
			provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
		).rejects.toMatchObject<Partial<ProviderError>>({
			code: 'azure_openai_classic_error',
		});
	});

	test('streams Azure OpenAI Classic chunks', async () => {
		const provider = new AzureOpenAIClassicProvider({
			resourceEndpoint: 'https://classic.openai.azure.com',
			apiKey: 'classic-key',
			deployment: 'legacy-chat',
			fetcher: createStreamingFetch(streamingResponse('legacy-chat')),
		});

		const chunks: ChatCompletionChunk[] = [];
		for await (const chunk of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
			chunks.push(chunk);
		}

		expect(chunks[1]?.delta.tool_calls?.[0]?.function.arguments).toBe('{"q"');
	});
});
