import "openai/shims/node";
/* global describe, expect, test */
import {
  ProviderError,
  clearCatalogMemoryCache,
  fetchCatalog,
  getModels,
} from "../../src/providers";
import { createJsonFetch } from "./helpers";

const catalogPayload = [
  {
    id: "openai/gpt-4.1",
    name: "GPT-4.1",
    publisher: "openai",
    capabilities: ["streaming", "tool-calling"],
    limits: { max_input_tokens: 100000 },
    supported_input_modalities: ["text"],
    rate_limit_tier: "high",
  },
  {
    id: "example/no-tools",
    name: "No tools",
    publisher: "example",
    capabilities: ["streaming"],
    limits: { max_input_tokens: 1000 },
    supported_input_modalities: ["text"],
  },
];

describe("GitHub Models catalog", () => {
  beforeEach(() => {
    clearCatalogMemoryCache();
  });

  test("fetches and parses every catalog model", async () => {
    const payload = Array.from({ length: 43 }, (_value, index) => ({
      id: `publisher/model-${index}`,
      name: `Model ${index}`,
      publisher: index % 2 === 0 ? "OpenAI" : "Meta",
      capabilities: index % 3 === 0 ? ["streaming", "tool-calling"] : ["streaming"],
      limits: { max_input_tokens: 1000 + index },
      supported_input_modalities: ["text"],
    }));
    const fetcher = createJsonFetch(payload);

    const models = await getModels("all-models", fetcher, 1000);

    expect(fetcher.requests[0]?.url).toBe("https://models.github.ai/catalog/models");
    expect(models).toHaveLength(43);
    expect(models[0]).toMatchObject({
      id: "publisher/model-0",
      supportsTools: true,
      supportsStreaming: true,
    });
  });

  test("does not filter out models without tool support", async () => {
    const fetcher = createJsonFetch(catalogPayload);

    const models = await getModels("unfiltered", fetcher, 1000);

    expect(models.map((model) => model.id)).toEqual(["openai/gpt-4.1", "example/no-tools"]);
  });

  test("uses memory cache inside the 1h TTL", async () => {
    const fetcher = createJsonFetch(catalogPayload);

    await fetchCatalog("memory", fetcher, 1000);
    await fetchCatalog("memory", fetcher, 1000 + 60_000);

    expect(fetcher.requests).toHaveLength(1);
  });

  test("surfaces fetch errors to the caller", async () => {
    const fetcher = createJsonFetch({ message: "no" }, 503);

    await expect(fetchCatalog("failure", fetcher, 1000)).rejects.toMatchObject<
      Partial<ProviderError>
    >({
      code: "catalog_fetch_failed",
    });
  });
});
