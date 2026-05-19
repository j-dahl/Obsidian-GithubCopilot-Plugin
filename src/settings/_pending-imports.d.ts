import type { PluginSettings, SecurityPreset } from "./settings";

export interface CatalogModelInfo {
id: string;
name?: string;
publisher?: string;
capabilities?: string[];
limits?: { max_input_tokens?: number };
supported_input_modalities?: string[];
}

export interface CatalogModule {
getModels(): Promise<CatalogModelInfo[]>;
}

export interface McpDiscoveredServer {
id?: string;
name?: string;
command?: string;
args?: string[];
env?: Record<string, string>;
url?: string;
headers?: Record<string, string>;
source?: string;
}

export interface McpDiscoveryModule {
McpDiscovery: {
discoverAllConfigs(): Promise<McpDiscoveredServer[]>;
};
}

export interface PresetsModule {
applyPreset(settings: PluginSettings, preset: SecurityPreset): PluginSettings | void;
}

export interface GitHubTokenModule {
getGitHubToken(): Promise<string | undefined>;
}