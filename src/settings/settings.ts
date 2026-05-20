import type { Conversation } from "../chat/types";

export type BackendType =
  | "github-models"
  | "github-copilot"
  | "azure-foundry"
  | "azure-openai-classic";
export type SecurityPreset = "strict" | "balanced" | "trusted";

export interface McpServerPermissionEntry {
  id: string;
  name: string;
  enabled: boolean;
  autoApproveReadOnly: boolean;
  autoApproveAll: boolean;
  disabledTools: string[];
  toolPolicies: Record<string, "auto-allow" | "ask" | "deny">;
  allowInsecureLocal?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  source?: string;
}

export interface AgentPermissionSettings {
  allowReadActiveFile: boolean;
  allowReadVaultFiles: boolean;
  allowReadExternalFiles: boolean;
  allowWriteVaultFiles: boolean;
  allowWriteExternalFiles: boolean;
  allowEnvVarAccess: boolean;
  allowNetworkEgress: boolean;
  blockDestructiveTools: boolean;
  requireConsentForOpenWorld: boolean;
}

export interface PluginSettings extends AgentPermissionSettings {
  backend: BackendType;
  selectedModel: string;
  githubToken: string;
  githubModelName: string;
  azureEndpoint: string;
  azureApiKey: string;
  azureDeploymentName: string;
  classicEndpoint: string;
  classicApiKey: string;
  classicApiVersion: string;
  maxTokens: number;
  temperature: number;
  customSystemPromptAddendum: string;
  preset: SecurityPreset;
  mcpServers: McpServerPermissionEntry[];
  trustedFolders: string[];
  trustedFrontmatterKey: string;
  auditLogEnabled: boolean;
  auditLogPath: string;
  auditLogMaxSizeMb: number;
  streamResponses: boolean;
  nativeToolPolicies: Record<string, "auto-allow" | "ask" | "deny">;
  trustedContentOnboarded: boolean;
  chatConversations: Conversation[];
  currentChatConversationId: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  backend: "github-models",
  selectedModel: "openai/gpt-4.1",
  githubToken: "",
  githubModelName: "openai/gpt-4.1",
  azureEndpoint: "",
  azureApiKey: "",
  azureDeploymentName: "",
  classicEndpoint: "",
  classicApiKey: "",
  classicApiVersion: "2024-10-21",
  maxTokens: 4096,
  temperature: 0.2,
  customSystemPromptAddendum: "",
  preset: "balanced",
  allowReadActiveFile: true,
  allowReadVaultFiles: false,
  allowReadExternalFiles: false,
  allowWriteVaultFiles: false,
  allowWriteExternalFiles: false,
  allowEnvVarAccess: false,
  allowNetworkEgress: false,
  blockDestructiveTools: true,
  requireConsentForOpenWorld: true,
  mcpServers: [],
  trustedFolders: [],
  trustedFrontmatterKey: "agent-trusted",
  auditLogEnabled: true,
  auditLogPath: "audit.jsonl",
  auditLogMaxSizeMb: 10,
  streamResponses: true,
  nativeToolPolicies: {},
  trustedContentOnboarded: false,
  chatConversations: [],
  currentChatConversationId: "",
};
