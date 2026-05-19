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
  ProviderPingResult,
} from "./types";
import { ProviderConfigError } from "./types";

export interface AzureOpenAIClassicProviderConfig {
  resourceEndpoint: string;
  deployment: string;
  apiKey: string;
  fetcher?: FetchLike;
  apiVersion?: string;
  allowInsecureLocal?: boolean;
}

export class AzureOpenAIClassicProvider implements ChatCompletionProvider {
  readonly id = "azure-openai-classic";
  readonly displayName = "Azure OpenAI Classic";
  readonly supportsTools = true;
  private readonly base: OpenAIChatCompletionProviderBase;

  constructor(config: AzureOpenAIClassicProviderConfig) {
    const endpoint = normalizeEndpoint(validateProviderEndpoint(requireString(config.resourceEndpoint, "resourceEndpoint"), config.allowInsecureLocal));
    const deployment = requireString(config.deployment, "deployment");
    this.base = new OpenAIChatCompletionProviderBase({
      defaultModel: deployment,
      errorCode: "azure_openai_classic_error",
      client: new OpenAI({
        apiKey: "placeholder",
        dangerouslyAllowBrowser: true,
        baseURL: `${endpoint}openai/deployments/${encodeURIComponent(deployment)}`,
        defaultQuery: { "api-version": config.apiVersion ?? "2024-10-21" },
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

  ping(): Promise<ProviderPingResult> {
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
