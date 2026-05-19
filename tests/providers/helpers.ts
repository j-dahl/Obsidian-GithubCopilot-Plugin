import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { ReadableStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';

export interface CapturedRequest {
	url: string;
	headers: Headers;
	body: unknown;
	signal?: AbortSignal;
}

export type MockFetch = typeof fetch & {
	requests: CapturedRequest[];
};

function mockResponse(
	body: string | ReadableStream<Uint8Array>,
	status: number,
	contentType: string,
): Response {
	const headers = new Headers({ 'content-type': contentType });
	const response = {
		ok: status >= 200 && status < 300,
		status,
		statusText: String(status),
		headers,
		body,
		json: async (): Promise<unknown> => JSON.parse(typeof body === 'string' ? body : '{}') as unknown,
		text: async (): Promise<string> => (typeof body === 'string' ? body : ''),
	} satisfies Partial<Response>;
	return response as Response;
}

function parseBody(body: BodyInit | null | undefined): unknown {
	if (typeof body !== 'string') {
		return undefined;
	}
	return JSON.parse(body) as unknown;
}

function inputUrl(input: RequestInfo | URL): string {
	if (typeof input === 'string') {
		return input;
	}
	if (input instanceof URL) {
		return input.toString();
	}
	return input.url;
}

export function createJsonFetch(response: unknown, status = 200): MockFetch {
	const requests: CapturedRequest[] = [];
	const mock = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		requests.push({
			url: inputUrl(input),
			headers: new Headers(init?.headers),
			body: parseBody(init?.body),
			signal: init?.signal ?? undefined,
		});
		return mockResponse(JSON.stringify(response), status, 'application/json');
	}) as MockFetch;
	mock.requests = requests;
	return mock;
}

export function createStreamingFetch(sse: string): MockFetch {
	const requests: CapturedRequest[] = [];
	const mock = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		requests.push({
			url: inputUrl(input),
			headers: new Headers(init?.headers),
			body: parseBody(init?.body),
			signal: init?.signal ?? undefined,
		});
		const encoder = new TextEncoder();
		return mockResponse(
			new ReadableStream<Uint8Array>({
				start(controller): void {
					controller.enqueue(encoder.encode(sse));
					controller.close();
				},
			}),
			200,
			'text/event-stream',
		);
	}) as MockFetch;
	mock.requests = requests;
	return mock;
}

export function completionResponse(model = 'openai/gpt-4.1'): unknown {
	return {
		id: 'chatcmpl_1',
		object: 'chat.completion',
		created: 1,
		model,
		choices: [
			{
				index: 0,
				message: {
					role: 'assistant',
					content: 'hello',
					tool_calls: [
						{
							id: 'call_1',
							type: 'function',
							function: { name: 'lookup', arguments: '{"q":"x"}' },
						},
					],
				},
				finish_reason: 'tool_calls',
			},
		],
		usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
	};
}

export function streamingResponse(model = 'openai/gpt-4.1'): string {
	return [
		`data: ${JSON.stringify({
			id: 'chunk_1',
			object: 'chat.completion.chunk',
			created: 1,
			model,
			choices: [{ index: 0, delta: { content: 'hel' }, finish_reason: null }],
		})}`,
		'',
		`data: ${JSON.stringify({
			id: 'chunk_2',
			object: 'chat.completion.chunk',
			created: 1,
			model,
			choices: [
				{
					index: 0,
					delta: {
						tool_calls: [
							{
								index: 0,
								id: 'call_1',
								type: 'function',
								function: { name: 'lookup', arguments: '{"q"' },
							},
						],
					},
					finish_reason: null,
				},
			],
		})}`,
		'',
		'data: [DONE]',
		'',
	].join('\n');
}

export async function cleanVault(name: string): Promise<string> {
	const path = join(cwd(), 'tests', 'providers', '.cache', name);
	await rm(path, { recursive: true, force: true });
	await mkdir(path, { recursive: true });
	return path;
}
