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
import { ProviderConfigError } from "./types";

export interface AzureFoundryProviderConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  fetcher?: FetchLike;
  allowInsecureLocal?: boolean;
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
        baseURL: normalizeEndpoint(validateProviderEndpoint(requireString(config.endpoint, "endpoint"), config.allowInsecureLocal)),
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

function validateProviderEndpoint(endpoint: string, allowInsecureLocal = false): string {
  const parsed = new URL(endpoint);
  if (parsed.username || parsed.password) throw new ProviderConfigError("Provider endpoint must not include credentials.");
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(allowInsecureLocal && local && parsed.protocol === "http:")) {
    throw new ProviderConfigError("Provider endpoint must use HTTPS.");
  }
  return endpoint;
}
