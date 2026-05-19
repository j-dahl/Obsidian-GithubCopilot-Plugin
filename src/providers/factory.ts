import {
	AzureFoundryProvider,
	type AzureFoundryProviderConfig,
} from './AzureFoundryProvider';
import {
	AzureOpenAIClassicProvider,
	type AzureOpenAIClassicProviderConfig,
} from './AzureOpenAIClassicProvider';
import {
	GitHubCopilotProvider,
	type CopilotSessionTokenStore,
} from './GitHubCopilotProvider';
import { GitHubModelsProvider } from './GitHubModelsProvider';
import { requireString, type FetchLike } from './openaiAdapter';
import { ProviderError, type ChatCompletionProvider } from './types';

export type ProviderBackend =
	| 'github-models'
	| 'github-copilot'
	| 'azure-foundry'
	| 'azure-openai-classic';

export interface BaseProviderFactoryConfig {
	backend: ProviderBackend;
	model?: string;
	fetcher?: FetchLike;
}

export interface GitHubModelsFactoryConfig extends BaseProviderFactoryConfig {
	backend: 'github-models';
	token?: string;
	vaultPath?: string;
}

export interface GitHubCopilotFactoryConfig extends BaseProviderFactoryConfig {
	backend: 'github-copilot';
	model?: string;
}

export interface AzureFoundryFactoryConfig extends BaseProviderFactoryConfig {
	backend: 'azure-foundry';
	endpoint?: string;
	apiKey?: string;
	deployment?: string;
}

export interface AzureOpenAIClassicFactoryConfig extends BaseProviderFactoryConfig {
	backend: 'azure-openai-classic';
	resourceEndpoint?: string;
	apiKey?: string;
	deployment?: string;
}

export type ProviderFactoryConfig =
	| GitHubModelsFactoryConfig
	| GitHubCopilotFactoryConfig
	| AzureFoundryFactoryConfig
	| AzureOpenAIClassicFactoryConfig;

export interface ProviderFactoryDeps {
	obsidianVersion: string;
	pluginVersion: string;
	sessionTokenStore?: CopilotSessionTokenStore;
}

function deployment(config: { deployment?: string; model?: string }): string {
	return requireString(config.deployment ?? config.model, 'deployment');
}

export function createProvider(
	config: ProviderFactoryConfig,
	deps: ProviderFactoryDeps,
): ChatCompletionProvider {
	switch (config.backend) {
		case 'github-models':
			return new GitHubModelsProvider({
				token: requireString(config.token, 'token'),
				model: config.model,
				vaultPath: config.vaultPath,
				fetcher: config.fetcher,
			});
		case 'github-copilot': {
			if (deps.sessionTokenStore === undefined) {
				throw new ProviderError(
					'missing_config',
					'Missing required provider dependency: sessionTokenStore',
				);
			}
			return new GitHubCopilotProvider({
				model: requireString(config.model, 'model'),
				sessionTokenStore: deps.sessionTokenStore,
				obsidianVersion: requireString(deps.obsidianVersion, 'obsidianVersion'),
				pluginVersion: requireString(deps.pluginVersion, 'pluginVersion'),
				fetcher: config.fetcher,
			});
		}
		case 'azure-foundry': {
			const providerConfig: AzureFoundryProviderConfig = {
				endpoint: requireString(config.endpoint, 'endpoint'),
				apiKey: requireString(config.apiKey, 'apiKey'),
				deployment: deployment(config),
				fetcher: config.fetcher,
			};
			return new AzureFoundryProvider(providerConfig);
		}
		case 'azure-openai-classic': {
			const providerConfig: AzureOpenAIClassicProviderConfig = {
				resourceEndpoint: requireString(config.resourceEndpoint, 'resourceEndpoint'),
				apiKey: requireString(config.apiKey, 'apiKey'),
				deployment: deployment(config),
				fetcher: config.fetcher,
			};
			return new AzureOpenAIClassicProvider(providerConfig);
		}
		default:
			throw new ProviderError('unsupported_backend', 'Unsupported provider backend');
	}
}
