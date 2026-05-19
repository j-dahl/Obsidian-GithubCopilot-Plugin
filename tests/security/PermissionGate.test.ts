import { evaluate } from '../../src/security/PermissionGate';
import { applyPreset, DEFAULT_PERMISSION_SETTINGS } from '../../src/security/presets';
import type { AgentPermissionSettings, PermissionContext, ToolAnnotations } from '../../src/security/types';

const tool = { serverId: 'filesystem', name: 'read_file', qualifiedName: 'filesystem__read_file' };

function settings(preset: AgentPermissionSettings['preset'], overrides: Partial<AgentPermissionSettings> = {}): AgentPermissionSettings {
  return {
    ...applyPreset(preset, DEFAULT_PERMISSION_SETTINGS),
    ...overrides,
    mcpServers: {
      filesystem: {
        serverId: 'filesystem',
        disabledTools: [],
        toolPolicies: {},
        autoApproveReadOnly: false,
        autoApproveAll: false,
      },
      ...(overrides.mcpServers ?? {}),
    },
  };
}

function ctx(
  preset: AgentPermissionSettings['preset'],
  annotations: ToolAnnotations | undefined,
  overrides: Partial<AgentPermissionSettings> = {},
): PermissionContext {
  return {
    tool,
    annotations,
    settings: settings(preset, overrides),
    conversationId: 'c1',
    sessionAllowed: new Set<string>(),
    scope: 'mcp',
  };
}

describe('PermissionGate', () => {
  const cases: Array<[string, AgentPermissionSettings['preset'], ToolAnnotations | undefined, Partial<AgentPermissionSettings>, string]> = [
    ['strict read-only asks', 'strict', { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, {}, 'ask'],
    ['strict destructive denied', 'strict', { destructiveHint: true, openWorldHint: false }, {}, 'deny'],
    ['strict missing annotations denied', 'strict', undefined, {}, 'deny'],
    ['strict network denied', 'strict', { destructiveHint: false, openWorldHint: true }, {}, 'deny'],
    ['balanced read-only asks', 'balanced', { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, {}, 'ask'],
    ['balanced destructive asks', 'balanced', { destructiveHint: true, openWorldHint: false }, {}, 'ask'],
    ['balanced missing annotations denied by network', 'balanced', undefined, {}, 'deny'],
    ['balanced network denied', 'balanced', { destructiveHint: false, openWorldHint: true }, {}, 'deny'],
    ['trusted read-only allowed', 'trusted', { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, {}, 'auto-allow'],
    ['trusted destructive asks', 'trusted', { destructiveHint: true, openWorldHint: false }, {}, 'ask'],
    ['trusted network asks', 'trusted', { destructiveHint: false, openWorldHint: true }, {}, 'ask'],
    ['trusted missing annotations asks', 'trusted', undefined, {}, 'ask'],
    ['block destructive override denies balanced', 'balanced', { destructiveHint: true }, { blockDestructiveTools: true }, 'deny'],
    ['block missing annotations denies', 'trusted', undefined, { blockDestructiveTools: true }, 'deny'],
    [
      'disabled tool denies',
      'trusted',
      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      { mcpServers: { filesystem: { serverId: 'filesystem', disabledTools: ['read_file'], toolPolicies: {}, autoApproveReadOnly: false, autoApproveAll: false } } },
      'deny',
    ],
    [
      'server disabled denies',
      'trusted',
      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      { mcpServers: { filesystem: { serverId: 'filesystem', disabled: true, disabledTools: [], toolPolicies: {}, autoApproveReadOnly: true, autoApproveAll: true } } },
      'deny',
    ],
    [
      'saved auto allow wins',
      'balanced',
      { destructiveHint: false, openWorldHint: false },
      { mcpServers: { filesystem: { serverId: 'filesystem', disabledTools: [], toolPolicies: { read_file: 'auto-allow' }, autoApproveReadOnly: false, autoApproveAll: false } } },
      'auto-allow',
    ],
    [
      'saved deny wins',
      'trusted',
      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      { mcpServers: { filesystem: { serverId: 'filesystem', disabledTools: [], toolPolicies: { read_file: 'deny' }, autoApproveReadOnly: true, autoApproveAll: true } } },
      'deny',
    ],
    [
      'saved ask wins',
      'trusted',
      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      { mcpServers: { filesystem: { serverId: 'filesystem', disabledTools: [], toolPolicies: { read_file: 'ask' }, autoApproveReadOnly: true, autoApproveAll: true } } },
      'ask',
    ],
    [
      'auto approve readonly server',
      'balanced',
      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      { mcpServers: { filesystem: { serverId: 'filesystem', disabledTools: [], toolPolicies: {}, autoApproveReadOnly: true, autoApproveAll: false } } },
      'auto-allow',
    ],
    [
      'auto approve all server',
      'balanced',
      { destructiveHint: true, openWorldHint: false },
      { mcpServers: { filesystem: { serverId: 'filesystem', disabledTools: [], toolPolicies: {}, autoApproveReadOnly: false, autoApproveAll: true } } },
      'auto-allow',
    ],
    ['balanced non-network non-destructive asks', 'balanced', { destructiveHint: false, openWorldHint: false }, {}, 'ask'],
    ['strict non-network non-destructive asks', 'strict', { destructiveHint: false, openWorldHint: false }, {}, 'ask'],
    ['trusted non-network non-destructive asks', 'trusted', { destructiveHint: false, openWorldHint: false }, {}, 'ask'],
    ['strict readonly with open world asks before network gate', 'strict', { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, {}, 'ask'],
    ['balanced readonly with open world asks before network gate', 'balanced', { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, {}, 'ask'],
    ['trusted readonly with open world allowed by read-only first', 'trusted', { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, {}, 'auto-allow'],
    ['balanced idempotent still asks', 'balanced', { idempotentHint: true, destructiveHint: false, openWorldHint: false }, {}, 'ask'],
    ['strict idempotent still asks', 'strict', { idempotentHint: true, destructiveHint: false, openWorldHint: false }, {}, 'ask'],
    ['trusted idempotent still asks', 'trusted', { idempotentHint: true, destructiveHint: false, openWorldHint: false }, {}, 'ask'],
  ];

  test.each(cases)('%s', (_name, preset, annotations, overrides, expected) => {
    expect(evaluate(ctx(preset, annotations, overrides)).policy).toBe(expected);
  });

  test('session allow is auto-allow', () => {
    const testCtx = ctx('balanced', { destructiveHint: false, openWorldHint: false });
    testCtx.sessionAllowed.add('filesystem__read_file');
    expect(evaluate(testCtx)).toEqual({ policy: 'auto-allow', reason: 'allowed for this conversation' });
  });

  test('native saved policy is used', () => {
    expect(
      evaluate({
        tool: { name: 'read-current-file' },
        settings: settings('balanced', { nativeToolPolicies: { 'read-current-file': 'auto-allow' } }),
        conversationId: 'c1',
        sessionAllowed: new Set<string>(),
        scope: 'native',
      }).policy,
    ).toBe('auto-allow');
  });

  test('pure evaluation does not mutate settings or session set', () => {
    const immutableSettings = settings('balanced');
    const before = JSON.stringify(immutableSettings);
    const sessionAllowed = new Set<string>();
    evaluate({ tool, settings: immutableSettings, conversationId: 'c1', sessionAllowed, scope: 'mcp' });
    expect(JSON.stringify(immutableSettings)).toBe(before);
    expect(sessionAllowed.size).toBe(0);
  });

  test('covers preset annotation truth table', () => {
    const annotations: Array<ToolAnnotations | undefined> = [
      undefined,
      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      { destructiveHint: true, openWorldHint: false },
      { destructiveHint: false, openWorldHint: true },
      { destructiveHint: false, openWorldHint: false },
    ];
    const results = ['strict', 'balanced', 'trusted'].flatMap((preset) =>
      annotations.map((annotation) => evaluate(ctx(preset as AgentPermissionSettings['preset'], annotation)).policy),
    );
    expect(results).toHaveLength(15);
  });
});
