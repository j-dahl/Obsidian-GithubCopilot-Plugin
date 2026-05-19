import type { DataAdapter } from 'obsidian';
import type { AuditLogEntry } from './types';

// eslint-disable-next-line obsidianmd/hardcoded-config-path -- The audit log path is part of the plugin security spec.
const AUDIT_PATH = '.obsidian/plugins/github-copilot-agent/audit.jsonl';
const MAX_BYTES = 10 * 1024 * 1024;
const SECRET_KEY_PATTERN = /key|token|secret|password|api[-_]?key|authorization|credential/i;

function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
interface VaultLike {
  adapter: DataAdapter;
}

interface AppLike {
  vault: VaultLike;
}

export class AuditLogger {
  private readonly adapter: DataAdapter;
  private queue: Promise<void> = Promise.resolve();
  private readonly sessionId: string;

  constructor(app: AppLike, sessionId: string = uuidv4()) {
    this.adapter = app.vault.adapter;
    this.sessionId = sessionId;
  }

  async log(entry: AuditLogEntry): Promise<void> {
    const queued = this.queue.then(() => this.writeEntry(entry));
    this.queue = queued.catch(() => undefined);
    return queued;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  private async writeEntry(entry: AuditLogEntry): Promise<void> {
    await this.ensureFolder();
    const redacted = redactSecrets(entry.args);
    const normalized: AuditLogEntry = {
      ...entry,
      requestId: entry.requestId || uuidv4(),
      sessionId: entry.sessionId || this.sessionId,
      args: redacted.value,
      argsSanitized: entry.argsSanitized || redacted.sanitized,
    };
    await this.rotateIfNeeded();
    const line = `${JSON.stringify(normalized)}\n`;
    await this.adapter.append(AUDIT_PATH, line);
  }

  private async ensureFolder(): Promise<void> {
    // eslint-disable-next-line obsidianmd/hardcoded-config-path -- Must match AUDIT_PATH's configured plugin directory.
    const folder = '.obsidian/plugins/github-copilot-agent';
    if (!(await this.adapter.exists(folder))) {
      await this.adapter.mkdir(folder);
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    if (!(await this.adapter.exists(AUDIT_PATH))) {
      return;
    }
    const stat = await this.adapter.stat(AUDIT_PATH);
    if (!stat || stat.size < MAX_BYTES) {
      return;
    }

    if (await this.adapter.exists(`${AUDIT_PATH}.3`)) {
      await this.adapter.remove(`${AUDIT_PATH}.3`);
    }
    for (const index of [2, 1] as const) {
      const from = `${AUDIT_PATH}.${index}`;
      if (await this.adapter.exists(from)) {
        await this.adapter.rename(from, `${AUDIT_PATH}.${index + 1}`);
      }
    }
    await this.adapter.rename(AUDIT_PATH, `${AUDIT_PATH}.1`);
  }
}

export function redactSecrets(args: Record<string, unknown>): { value: Record<string, unknown>; sanitized: boolean } {
  let sanitized = false;

  const redactValue = (value: unknown, key?: string): unknown => {
    if (key && SECRET_KEY_PATTERN.test(key)) {
      sanitized = true;
      return '[REDACTED]';
    }
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
          entryKey,
          redactValue(entryValue, entryKey),
        ]),
      );
    }
    return value;
  };

  return { value: redactValue(args) as Record<string, unknown>, sanitized };
}

export const AUDIT_LOG_PATH = AUDIT_PATH;
export const AUDIT_LOG_MAX_BYTES = MAX_BYTES;