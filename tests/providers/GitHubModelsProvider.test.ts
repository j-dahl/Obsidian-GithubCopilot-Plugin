import 'openai/shims/node';
/* global describe, expect, test */
import {
	GitHubModelsProvider,
	ProviderError,
	type ChatCompletionChunk,
} from '../../src/providers';
import {
	completionResponse,
	createJsonFetch,
	createStreamingFetch,
	streamingResponse,
} from './helpers';

describe('GitHubModelsProvider', () => {
	test('sends OpenAI-compatible requests to GitHub Models', async () => {
		const fetcher = createJsonFetch(completionResponse());
		const provider = new GitHubModelsProvider({
			token: 'ghp_test',
			model: 'openai/gpt-4.1',
			fetcher,
		});

		const result = await provider.complete({
			messages: [
				{ role: 'user', content: 'hi' },
				{
					role: 'assistant',
					content: null,
					tool_calls: [
						{
							id: 'call_1',
							type: 'function',
							function: { name: 'lookup', arguments: '{"q":"x"}' },
						},
					],
				},
				{ role: 'tool', content: 'ok', tool_call_id: 'call_1' },
			],
			tools: [
				{
					type: 'function',
					function: { name: 'lookup', parameters: { type: 'object' } },
				},
			],
			maxTokens: 5,
			temperature: 0.2,
		});

		expect(result.message.tool_calls?.[0]?.function.name).toBe('lookup');
		const request = fetcher.requests[0];
		expect(request?.url).toBe('https://models.github.ai/inference/chat/completions');
		expect(request?.headers.get('authorization')).toBe('Bearer ghp_test');
		expect(request?.headers.get('x-github-api-version')).toBe('2026-03-10');
		expect(request?.headers.get('accept')).toContain('application/vnd.github+json');
		expect(request?.body).toMatchObject({
			model: 'openai/gpt-4.1',
			max_tokens: 5,
			temperature: 0.2,
			tools: [{ type: 'function', function: { name: 'lookup' } }],
		});
	});

	test('maps HTTP errors to ProviderError', async () => {
		const provider = new GitHubModelsProvider({
			token: 'ghp_test',
			fetcher: createJsonFetch({ error: { message: 'boom' } }, 500),
		});

		await expect(
			provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
		).rejects.toMatchObject<Partial<ProviderError>>({ code: 'github_models_error' });
	});

	test('streams chunks and aborts on early return', async () => {
		const fetcher = createStreamingFetch(streamingResponse());
		const provider = new GitHubModelsProvider({ token: 'ghp_test', fetcher });

		const iterator = provider.stream({ messages: [{ role: 'user', content: 'hi' }] });
		const first = await iterator.next();
		await iterator.return(undefined);
		const chunk = first.value as ChatCompletionChunk | undefined;

		expect(chunk?.delta.content).toBe('hel');
		expect(fetcher.requests[0]?.body).toMatchObject({ stream: true });
		expect(fetcher.requests[0]?.signal?.aborted).toBe(true);
	});
});
