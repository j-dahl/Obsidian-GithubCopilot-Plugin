import { DEFAULT_PERMISSION_SETTINGS, applyPreset } from '../../src/security/presets';

describe('presets', () => {
  test('strict preset shape', () => {
    expect(applyPreset('strict', DEFAULT_PERMISSION_SETTINGS)).toMatchObject({
      preset: 'strict',
      readCurrentFile: 'auto-allow',
      readVaultFiles: 'deny',
      readOutsideVault: 'deny',
      writeVaultNotes: 'deny',
      mcpReadOnlyTools: 'ask',
      mcpDestructiveTools: 'deny',
      networkEgress: 'deny',
      envVarAccess: 'deny',
      blockDestructiveTools: true,
    });
  });

  test('balanced preset shape', () => {
    expect(applyPreset('balanced', DEFAULT_PERMISSION_SETTINGS)).toMatchObject({
      preset: 'balanced',
      readCurrentFile: 'auto-allow',
      readVaultFiles: 'ask',
      readOutsideVault: 'deny',
      writeVaultNotes: 'ask',
      mcpReadOnlyTools: 'ask',
      mcpDestructiveTools: 'ask',
      networkEgress: 'deny',
      envVarAccess: 'deny',
      blockDestructiveTools: false,
    });
  });

  test('trusted preset shape', () => {
    expect(applyPreset('trusted', DEFAULT_PERMISSION_SETTINGS)).toMatchObject({
      preset: 'trusted',
      readCurrentFile: 'auto-allow',
      readVaultFiles: 'auto-allow',
      readOutsideVault: 'ask',
      writeVaultNotes: 'ask',
      mcpReadOnlyTools: 'auto-allow',
      mcpDestructiveTools: 'ask',
      networkEgress: 'ask',
      envVarAccess: 'deny',
      blockDestructiveTools: false,
    });
  });

  test('returns immutable copy', () => {
    const original = {
      ...DEFAULT_PERMISSION_SETTINGS,
      trustedFolders: ['A'],
      mcpServers: {
        s: { serverId: 's', disabledTools: ['x'], toolPolicies: { x: 'ask' as const }, autoApproveReadOnly: false, autoApproveAll: false },
      },
    };
    const next = applyPreset('trusted', original);
    next.trustedFolders.push('B');
    next.mcpServers.s?.disabledTools.push('y');
    expect(original.trustedFolders).toEqual(['A']);
    expect(original.mcpServers.s?.disabledTools).toEqual(['x']);
  });
});