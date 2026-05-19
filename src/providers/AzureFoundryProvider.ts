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

export interface AzureFoundryProviderConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  fetcher?: FetchLike;
}

export class AzureFoundryProvider implements ChatCompletionProvider {
  readonly id = "azure-foundry";
  readonly displayName = "Azure Foundry";
  readonly supportsTools = true;
  private readonly base: OpenAIChatCompletionProviderBase;

  constructor(config: AzureFoundryProviderConfig) {
    this.base = new OpenAIChatCompletionProviderBase({
      defaultModel: requireString(config.deployment, "deployment"),
      errorCode: "azure_foundry_error",
      client: new OpenAI({
        apiKey: requireString(config.apiKey, "apiKey"),
        dangerouslyAllowBrowser: true,
        baseURL: normalizeEndpoint(requireString(config.endpoint, "endpoint")),
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
