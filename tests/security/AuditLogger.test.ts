import { AUDIT_LOG_MAX_BYTES, AUDIT_LOG_PATH, AuditLogger, redactSecrets } from '../../src/security/AuditLogger';
import type { AuditLogEntry } from '../../src/security/types';

class MemoryAdapter {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async stat(path: string): Promise<{ size: number } | null> {
    const value = this.files.get(path);
    return value === undefined ? null : { size: value.length };
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, `${this.files.get(path) ?? ''}${data}`);
  }

  async read(path: string): Promise<string> {
    return this.files.get(path) ?? '';
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const value = this.files.get(from);
    if (value !== undefined) {
      this.files.set(to, value);
      this.files.delete(from);
    }
  }
}

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    requestId: '',
    timestamp: '2026-05-18T00:00:00.000Z',
    sessionId: '',
    source: 'agent',
    conversationId: 'c1',
    serverId: 'filesystem',
    toolName: 'read_file',
    qualifiedName: 'filesystem__read_file',
    args: { path: 'note.md' },
    argsSanitized: false,
    decision: 'auto-allowed',
    decisionReason: 'test',
    decisionPreset: 'balanced',
    status: 'success',
    ...overrides,
  };
}

describe('AuditLogger', () => {
  test('appends JSONL and generates request id', async () => {
    const adapter = new MemoryAdapter();
    const logger = new AuditLogger({ vault: { adapter } }, 'session-1');
    await logger.log(entry());
    const lines = (await adapter.read(AUDIT_LOG_PATH)).trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '{}') as AuditLogEntry;
    expect(parsed.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parsed.sessionId).toBe('session-1');
  });

  test('redacts secret-like keys recursively', async () => {
    const adapter = new MemoryAdapter();
    const logger = new AuditLogger({ vault: { adapter } }, 'session-1');
    await logger.log(entry({ args: { apiKey: 'abc', nested: { token: 'def' }, ok: 'visible' } }));
    const parsed = JSON.parse((await adapter.read(AUDIT_LOG_PATH)).trim()) as AuditLogEntry;
    expect(parsed.args).toEqual({ apiKey: '[REDACTED]', nested: { token: '[REDACTED]' }, ok: 'visible' });
    expect(parsed.argsSanitized).toBe(true);
  });

  test('standalone redaction reports sanitized flag', () => {
    expect(redactSecrets({ Authorization: 'Bearer x' })).toEqual({
      value: { Authorization: '[REDACTED]' },
      sanitized: true,
    });
  });

  test.each([
    [{ headers: 'Bearer ghu_xxx' }],
    [{ input_json: '{"api_key":"sk-proj-xxx"}' }],
    [{ curl_args: ['-H', 'Authorization: Bearer gho_xxx'] }],
    [{ body: 'tid=abc.def.ghi' }],
  ])('redacts secret value patterns %#', (args) => {
    const redacted = redactSecrets(args);
    expect(JSON.stringify(redacted.value)).toContain('[REDACTED]');
    expect(redacted.sanitized).toBe(true);
  });

  test('rotates audit file at 10MB and keeps three archives', async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set(AUDIT_LOG_PATH, 'x'.repeat(AUDIT_LOG_MAX_BYTES));
    adapter.files.set(`${AUDIT_LOG_PATH}.1`, 'one');
    adapter.files.set(`${AUDIT_LOG_PATH}.2`, 'two');
    adapter.files.set(`${AUDIT_LOG_PATH}.3`, 'three');
    const logger = new AuditLogger({ vault: { adapter } }, 'session-1');
    await logger.log(entry());
    expect(adapter.files.get(`${AUDIT_LOG_PATH}.1`)).toHaveLength(AUDIT_LOG_MAX_BYTES);
    expect(adapter.files.get(`${AUDIT_LOG_PATH}.2`)).toBe('one');
    expect(adapter.files.get(`${AUDIT_LOG_PATH}.3`)).toBe('two');
    expect(adapter.files.get(AUDIT_LOG_PATH)).toContain('filesystem__read_file');
  });

  test('serializes concurrent writes through one queue', async () => {
    const adapter = new MemoryAdapter();
    const logger = new AuditLogger({ vault: { adapter } }, 'session-1');
    await Promise.all([
      logger.log(entry({ toolName: 'a', qualifiedName: 'filesystem__a' })),
      logger.log(entry({ toolName: 'b', qualifiedName: 'filesystem__b' })),
      logger.log(entry({ toolName: 'c', qualifiedName: 'filesystem__c' })),
    ]);
    expect((await adapter.read(AUDIT_LOG_PATH)).trim().split('\n')).toHaveLength(3);
  });

  test('session id is stable across calls', async () => {
    const adapter = new MemoryAdapter();
    const logger = new AuditLogger({ vault: { adapter } }, 'session-stable');
    await logger.log(entry());
    await logger.log(entry());
    const sessions = (await adapter.read(AUDIT_LOG_PATH))
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as AuditLogEntry).sessionId);
    expect(sessions).toEqual(['session-stable', 'session-stable']);
  });
});
