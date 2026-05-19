import type { AgentPermissionSettings, McpServerPermissions, SecurityPreset } from './types';

const emptyServerPermissions = (serverId: string): McpServerPermissions => ({
  serverId,
  disabledTools: [],
  toolPolicies: {},
  autoApproveReadOnly: false,
  autoApproveAll: false,
});

export const DEFAULT_PERMISSION_SETTINGS: AgentPermissionSettings = {
  preset: 'balanced',
  blockDestructiveTools: false,
  trustedFolders: [],
  trustedFrontmatterKey: 'agent-trusted',
  nativeToolPolicies: {},
  mcpServers: {},
  readCurrentFile: 'auto-allow',
  readVaultFiles: 'ask',
  readOutsideVault: 'deny',
  writeVaultNotes: 'ask',
  mcpReadOnlyTools: 'ask',
  mcpDestructiveTools: 'ask',
  networkEgress: 'deny',
  envVarAccess: 'deny',
};

export function applyPreset(
  preset: SecurityPreset,
  settings: AgentPermissionSettings,
): AgentPermissionSettings {
  const base: AgentPermissionSettings = {
    ...settings,
    preset,
    trustedFolders: [...settings.trustedFolders],
    nativeToolPolicies: { ...settings.nativeToolPolicies },
    mcpServers: Object.fromEntries(
      Object.entries(settings.mcpServers).map(([serverId, server]) => [
        serverId,
        {
          ...emptyServerPermissions(server.serverId),
          ...server,
          disabledTools: [...server.disabledTools],
          toolPolicies: { ...server.toolPolicies },
        },
      ]),
    ),
  };

  if (preset === 'strict') {
    return {
      ...base,
      readCurrentFile: 'auto-allow',
      readVaultFiles: 'deny',
      readOutsideVault: 'deny',
      writeVaultNotes: 'deny',
      mcpReadOnlyTools: 'ask',
      mcpDestructiveTools: 'deny',
      networkEgress: 'deny',
      envVarAccess: 'deny',
      blockDestructiveTools: true,
    };
  }

  if (preset === 'trusted') {
    return {
      ...base,
      readCurrentFile: 'auto-allow',
      readVaultFiles: 'auto-allow',
      readOutsideVault: 'ask',
      writeVaultNotes: 'ask',
      mcpReadOnlyTools: 'auto-allow',
      mcpDestructiveTools: 'ask',
      networkEgress: 'ask',
      envVarAccess: 'deny',
      blockDestructiveTools: false,
    };
  }

  return {
    ...base,
    readCurrentFile: 'auto-allow',
    readVaultFiles: 'ask',
    readOutsideVault: 'deny',
    writeVaultNotes: 'ask',
    mcpReadOnlyTools: 'ask',
    mcpDestructiveTools: 'ask',
    networkEgress: 'deny',
    envVarAccess: 'deny',
    blockDestructiveTools: false,
  };
}