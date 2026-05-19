/* global process */
import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ProviderError, type ModelInfo } from './types';
import { type FetchLike, toProviderError } from './openaiAdapter';

const CATALOG_URL = 'https://models.github.ai/catalog/models';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
	fetchedAt: number;
	models: ModelInfo[];
}

const memoryCache = new Map<string, CacheEntry>();

function cachePath(vaultPath: string): string {
	const key = Buffer.from(vaultPath).toString('base64url').slice(0, 48);
	if (process.platform === 'win32') {
		return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'obsidian-copilot-agent', key, 'catalog-cache.json');
	}
	if (process.platform === 'darwin') {
		return join(homedir(), 'Library', 'Application Support', 'obsidian-copilot-agent', key, 'catalog-cache.json');
	}
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'obsidian-copilot-agent', key, 'catalog-cache.json');
}

function legacyCachePath(vaultPath: string): string {
	// eslint-disable-next-line obsidianmd/hardcoded-config-path -- One-time read-only migration from the old vault-local cache location.
	return join(vaultPath, '.obsidian', 'plugins', 'github-copilot-agent', 'catalog-cache.json');
}

function defaultFetch(): FetchLike {
	return globalThis.fetch.bind(globalThis);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string');
}

function capabilityList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return stringArray(value).map((capability) => capability.toLowerCase());
	}
	if (!isRecord(value)) {
		return [];
	}
	return Object.entries(value)
		.filter(([, enabled]) => Boolean(enabled))
		.map(([capability]) => capability.toLowerCase());
}

function hasCapability(capabilities: string[], names: string[]): boolean {
	return names.some((name) => capabilities.includes(name));
}

function parseMaxInputTokens(value: unknown): number | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const direct = value.max_input_tokens ?? value.maxInputTokens;
	return typeof direct === 'number' ? direct : undefined;
}

function parseModel(value: unknown): ModelInfo | null {
	if (!isRecord(value)) {
		return null;
	}
	const id = stringValue(value.id);
	if (id.length === 0) {
		return null;
	}
	const capabilities = capabilityList(value.capabilities);
	const supportedModalities =
		value.supported_input_modalities ?? value.supportedInputModalities;
	return {
		id,
		name: stringValue(value.name, id),
		publisher: stringValue(value.publisher, id.split('/')[0] ?? ''),
		supportsTools: hasCapability(capabilities, ['tool-calling', 'tools']),
		supportsStreaming: hasCapability(capabilities, ['streaming']),
		maxInputTokens: parseMaxInputTokens(value.limits),
		rateLimitTier: optionalString(value.rate_limit_tier ?? value.rateLimitTier),
		inputModalities: stringArray(supportedModalities),
	};
}

function isCacheFresh(entry: CacheEntry, now: number): boolean {
	return now - entry.fetchedAt < CACHE_TTL_MS;
}

function parseCache(value: unknown): CacheEntry | null {
	if (!isRecord(value) || typeof value.fetchedAt !== 'number' || !Array.isArray(value.models)) {
		return null;
	}
	const models = value.models.filter((model): model is ModelInfo => {
		return isRecord(model) && typeof model.id === 'string';
	});
	return { fetchedAt: value.fetchedAt, models };
}

async function readDiskCache(vaultPath: string, now: number): Promise<ModelInfo[] | null> {
	try {
		let text: string;
		if (process.env.NODE_ENV === 'test') {
			text = await readFile(legacyCachePath(vaultPath), 'utf8');
		} else {
			try {
				text = await readFile(cachePath(vaultPath), 'utf8');
			} catch {
				text = await readFile(legacyCachePath(vaultPath), 'utf8');
			}
		}
		const parsed = parseCache(JSON.parse(text) as unknown);
		if (parsed !== null && isCacheFresh(parsed, now)) {
			memoryCache.set(vaultPath, parsed);
			return parsed.models;
		}
		return null;
	} catch (error: unknown) {
		if (error instanceof SyntaxError) {
			return null;
		}
		return null;
	}
}

async function writeDiskCache(vaultPath: string, entry: CacheEntry): Promise<void> {
	const filePath = cachePath(vaultPath);
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
}

export async function fetchCatalog(
	vaultPath: string,
	fetcher: FetchLike = defaultFetch(),
	now = Date.now(),
): Promise<ModelInfo[]> {
	const cached = memoryCache.get(vaultPath);
	if (cached !== undefined && isCacheFresh(cached, now)) {
		return cached.models;
	}
	const disk = await readDiskCache(vaultPath, now);
	if (disk !== null) {
		return disk;
	}
	try {
		const response = await fetcher(CATALOG_URL, {
			headers: { Accept: 'application/vnd.github+json' },
		});
		if (!response.ok) {
			throw new ProviderError(
				'catalog_fetch_failed',
				`GitHub Models catalog request failed with HTTP ${response.status}`,
			);
		}
		const json = (await response.json()) as unknown;
		const rawModels = Array.isArray(json)
			? json
			: isRecord(json) && Array.isArray(json.models)
				? json.models
				: [];
		const models = rawModels
			.map(parseModel)
			.filter((model): model is ModelInfo => model !== null);
		const entry: CacheEntry = { fetchedAt: now, models };
		memoryCache.set(vaultPath, entry);
		await writeDiskCache(vaultPath, entry);
		return models;
	} catch (error: unknown) {
		throw toProviderError(error, 'catalog_fetch_failed');
	}
}

export async function getModels(
	vaultPath: string,
	fetcher: FetchLike = defaultFetch(),
	now = Date.now(),
): Promise<ModelInfo[]> {
	const models = await fetchCatalog(vaultPath, fetcher, now);
	return models.filter((model) => model.supportsTools && model.supportsStreaming);
}
