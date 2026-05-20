import { ProviderError, type ModelInfo } from "./types";
import { type FetchLike, toProviderError } from "./openaiAdapter";

const CATALOG_URL = "https://models.github.ai/catalog/models";
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  models: ModelInfo[];
}

const memoryCache = new Map<string, CacheEntry>();

function defaultFetch(): FetchLike {
  return globalThis.fetch.bind(globalThis);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
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
  return typeof direct === "number" ? direct : undefined;
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
  const supportedModalities = value.supported_input_modalities ?? value.supportedInputModalities;
  return {
    id,
    name: stringValue(value.name, id),
    publisher: stringValue(value.publisher, id.split("/")[0] ?? ""),
    supportsTools: hasCapability(capabilities, ["tool-calling", "tools"]),
    supportsStreaming: hasCapability(capabilities, ["streaming"]),
    maxInputTokens: parseMaxInputTokens(value.limits),
    rateLimitTier: optionalString(value.rate_limit_tier ?? value.rateLimitTier),
    inputModalities: stringArray(supportedModalities),
  };
}

function isCacheFresh(entry: CacheEntry, now: number): boolean {
  return now - entry.fetchedAt < CACHE_TTL_MS;
}

export async function fetchCatalog(
  vaultPath = "default",
  fetcher: FetchLike = defaultFetch(),
  now = Date.now()
): Promise<ModelInfo[]> {
  const cached = memoryCache.get(vaultPath);
  if (cached !== undefined && isCacheFresh(cached, now)) {
    return cached.models;
  }
  try {
    const response = await fetcher(CATALOG_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      throw new ProviderError(
        "catalog_fetch_failed",
        `GitHub Models catalog request failed with HTTP ${response.status}`
      );
    }
    const json = (await response.json()) as unknown;
    const rawModels = Array.isArray(json)
      ? json
      : isRecord(json) && Array.isArray(json.models)
        ? json.models
        : [];
    const models = rawModels.map(parseModel).filter((model): model is ModelInfo => model !== null);
    const entry: CacheEntry = { fetchedAt: now, models };
    memoryCache.set(vaultPath, entry);
    return models;
  } catch (error: unknown) {
    throw toProviderError(error, "catalog_fetch_failed");
  }
}

export async function getModels(
  vaultPath = "default",
  fetcher: FetchLike = defaultFetch(),
  now = Date.now()
): Promise<ModelInfo[]> {
  return fetchCatalog(vaultPath, fetcher, now);
}

export function clearCatalogMemoryCache(): void {
  memoryCache.clear();
}
