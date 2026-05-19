import type { TFile } from 'obsidian';

export type ToolPolicy = 'auto-allow' | 'ask' | 'deny';
export type SecurityPreset = 'strict' | 'balanced' | 'trusted';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface NormalizedTool {
  name: string;
  serverId?: string;
  qualifiedName?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServerPermissions {
  serverId: string;
  description?: string;
  disabled?: boolean;
  disabledTools: string[];
  toolPolicies: Record<string, ToolPolicy>;
  autoApproveReadOnly: boolean;
  autoApproveAll: boolean;
}

export interface AgentPermissionSettings {
  preset: SecurityPreset;
  blockDestructiveTools: boolean;
  trustedFolders: string[];
  trustedFrontmatterKey: string;
  nativeToolPolicies: Record<string, ToolPolicy>;
  mcpServers: Record<string, McpServerPermissions>;
  readCurrentFile: ToolPolicy;
  readVaultFiles: ToolPolicy;
  readOutsideVault: ToolPolicy;
  writeVaultNotes: ToolPolicy;
  mcpReadOnlyTools: ToolPolicy;
  mcpDestructiveTools: ToolPolicy;
  networkEgress: ToolPolicy;
  envVarAccess: ToolPolicy;
}

export type ConsentDecision =
  | { type: 'allow-once' }
  | { type: 'allow-session'; conversationId: string }
  | { type: 'allow-forever'; serverId: string; toolName: string }
  | { type: 'deny-once' }
  | { type: 'deny-forever'; serverId: string; toolName: string };

export type AuditDecision =
  | 'allowed'
  | 'auto-allowed'
  | 'denied-once'
  | 'denied-forever'
  | 'error'
  | 'aborted';

export type AuditStatus = 'success' | 'error' | 'aborted' | 'denied' | 'pending';
export type AuditSource = 'user' | 'agent';

export interface AuditLogEntry {
  requestId: string;
  timestamp: string;
  sessionId: string;
  source: AuditSource;
  conversationId: string;
  serverId: string;
  toolName: string;
  qualifiedName: string;
  annotations?: ToolAnnotations;
  args: Record<string, unknown>;
  argsSanitized: boolean;
  decision: AuditDecision;
  decisionReason: string;
  decisionPreset: SecurityPreset;
  status: AuditStatus;
  resultSummary?: string;
  durationMs?: number;
  isError?: boolean;
}

export interface PermissionContext {
  tool: NormalizedTool;
  annotations?: ToolAnnotations;
  settings: AgentPermissionSettings;
  conversationId: string;
  sessionAllowed: Set<string>;
  scope: 'native' | 'mcp';
}

export interface TrustedContentSettings {
  trustedFolders: string[];
  trustedFrontmatterKey: string;
}

export interface TrustedSourceFile extends Pick<TFile, 'path'> {
  frontmatter?: Record<string, unknown>;
}