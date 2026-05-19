/* global AsyncGenerator */
import OpenAI from "openai";
import {
  FetchLike,
  OpenAIChatCompletionProviderBase,
  normalizeEndpoint,
  requireString,
} from "./openaiAdapter";
import type {
  ChatCompletionOptions,
  ChatCompletionProvider,
  ChatCompletionResult,
  ChatCompletionChunk,
} from "./types";

export interface AzureOpenAIClassicProviderConfig {
  resourceEndpoint: string;
  deployment: string;
  apiKey: string;
  fetcher?: FetchLike;
}

export class AzureOpenAIClassicProvider implements ChatCompletionProvider {
  readonly id = "azure-openai-classic";
  readonly displayName = "Azure OpenAI Classic";
  readonly supportsTools = true;
  private readonly base: OpenAIChatCompletionProviderBase;

  constructor(config: AzureOpenAIClassicProviderConfig) {
    const endpoint = normalizeEndpoint(requireString(config.resourceEndpoint, "resourceEndpoint"));
    const deployment = requireString(config.deployment, "deployment");
    this.base = new OpenAIChatCompletionProviderBase({
      defaultModel: deployment,
      errorCode: "azure_openai_classic_error",
      client: new OpenAI({
        apiKey: "placeholder",
        dangerouslyAllowBrowser: true,
        baseURL: `${endpoint}openai/deployments/${encodeURIComponent(deployment)}`,
        defaultQuery: { "api-version": "2024-10-21" },
        defaultHeaders: { "api-key": requireString(config.apiKey, "apiKey") },
        fetch: config.fetcher as never,
      }),
    });
  }

  complete(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
    return this.base.complete(opts);
  }

  stream(opts: ChatCompletionOptions): AsyncGenerator<ChatCompletionChunk> {
    return this.base.stream(opts);
  }

  ping(): Promise<boolean> {
    return this.base.ping();
  }
}
