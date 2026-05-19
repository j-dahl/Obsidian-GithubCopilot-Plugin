import 'openai/shims/node';
/* global describe, expect, test */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fetchCatalog, getModels } from '../../src/providers';
import { cleanVault, createJsonFetch } from './helpers';

const catalogPayload = [
	{
		id: 'openai/gpt-4.1',
		name: 'GPT-4.1',
		publisher: 'openai',
		capabilities: ['streaming', 'tool-calling'],
		limits: { max_input_tokens: 100000 },
		supported_input_modalities: ['text'],
		rate_limit_tier: 'high',
	},
	{
		id: 'example/no-tools',
		name: 'No tools',
		publisher: 'example',
		capabilities: ['streaming'],
		limits: { max_input_tokens: 1000 },
		supported_input_modalities: ['text'],
	},
];

describe('GitHub Models catalog', () => {
	test('fetches, filters, and writes cache', async () => {
		const vault = await cleanVault('fetches');
		const fetcher = createJsonFetch(catalogPayload);

		const models = await getModels(vault, fetcher, 1000);

		expect(fetcher.requests[0]?.url).toBe('https://models.github.ai/catalog/models');
		expect(models).toHaveLength(1);
		expect(models[0]?.id).toBe('openai/gpt-4.1');
	});

	test('uses memory cache inside the 24h TTL', async () => {
		const vault = await cleanVault('memory');
		const fetcher = createJsonFetch(catalogPayload);

		await fetchCatalog(vault, fetcher, 1000);
		await fetchCatalog(vault, fetcher, 1000 + 60_000);

		expect(fetcher.requests).toHaveLength(1);
	});

	test('uses disk cache and expires after TTL', async () => {
		const vault = await cleanVault('disk');
		const cacheFile = join(
			vault,
			// eslint-disable-next-line obsidianmd/hardcoded-config-path
			'.obsidian',
			'plugins',
			'github-copilot-agent',
			'catalog-cache.json',
		);
		await mkdir(dirname(cacheFile), { recursive: true });
		await writeFile(
			cacheFile,
			JSON.stringify({
				fetchedAt: 1000,
				models: [
					{
						id: 'cached/model',
						name: 'Cached',
						publisher: 'cached',
						supportsTools: true,
						supportsStreaming: true,
						inputModalities: ['text'],
					},
				],
			}),
			'utf8',
		);
		const fetcher = createJsonFetch(catalogPayload);

		const cached = await fetchCatalog(vault, fetcher, 1000 + 60_000);
		const refreshed = await fetchCatalog(vault, fetcher, 1000 + 25 * 60 * 60 * 1000);

		expect(cached[0]?.id).toBe('cached/model');
		expect(refreshed[0]?.id).toBe('openai/gpt-4.1');
		expect(fetcher.requests).toHaveLength(1);
	});
});
