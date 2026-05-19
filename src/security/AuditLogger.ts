import type { DataAdapter } from "obsidian";
import type { AuditLogEntry } from "./types";
import type { CallToolResult, ToolCall } from "../chat/types";
import type { PluginSettings } from "../settings/settings";

const AUDIT_PATH = "audit.jsonl";
const MAX_BYTES = 10 * 1024 * 1024;
const SECRET_KEY_PATTERN = /key|token|secret|password|api[-_]?key|authorization|credential/i;
export const SECRET_VALUE_PATTERN =
  /\b(?:gho_[A-Za-z0-9_]+|ghu_[A-Za-z0-9_]+|ghs_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-(?:proj|live|test)?-?[A-Za-z0-9_-]{3,}|tid=[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;
const BEARER_VALUE_PATTERN = /\bBearer\s+[A-Za-z0-9._-]{3,}\b/g;

type AuditSettings = Pick<
  PluginSettings,
  "auditLogEnabled" | "auditLogPath" | "auditLogMaxSizeMb" | "preset"
>;

function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

  constructor(
    app: AppLike,
    sessionId: string = uuidv4(),
    private readonly getSettings: () => AuditSettings = () => ({
      auditLogEnabled: true,
      auditLogPath: AUDIT_PATH,
      auditLogMaxSizeMb: 10,
      preset: "balanced",
    })
  ) {
    this.adapter = app.vault.adapter;
    this.sessionId = sessionId;
  }

  async log(entry: AuditLogEntry): Promise<void> {
    if (this.getSettings().auditLogEnabled === false) return;
    const queued = this.queue.then(() => this.writeEntry(entry));
    this.queue = queued.catch(() => undefined);
    return queued;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async logToolCall(entry: {
    toolCall: ToolCall;
    decision: string;
    result?: CallToolResult;
    error?: string;
    timestamp: number;
  }): Promise<void> {
    const resultSummary =
      entry.error ??
      entry.result?.content
        .map((item) => item.text)
        .join("\n")
        .slice(0, 500);
    await this.log({
      requestId: entry.toolCall.id,
      timestamp: new Date(entry.timestamp).toISOString(),
      sessionId: this.sessionId,
      source: "agent",
      conversationId: "current",
      serverId: entry.toolCall.serverName,
      toolName: entry.toolCall.name,
      qualifiedName: `${entry.toolCall.serverName}__${entry.toolCall.name}`,
      annotations: entry.toolCall.annotations,
      args: entry.toolCall.arguments,
      argsSanitized: false,
      decision: entry.decision.includes("deny")
        ? "denied-once"
        : entry.decision === "auto-allow"
          ? "auto-allowed"
          : "allowed",
      decisionReason: entry.decision,
      decisionPreset: this.getSettings().preset,
      status:
        entry.error || entry.result?.isError
          ? "error"
          : entry.toolCall.status === "aborted"
            ? "aborted"
            : "success",
      resultSummary,
      isError: Boolean(entry.error || entry.result?.isError),
    });
  }

  private async writeEntry(entry: AuditLogEntry): Promise<void> {
    const auditPath = this.auditPath();
    await this.ensureFolder(auditPath);
    const redacted = redactSecrets(entry.args);
    const normalized: AuditLogEntry = {
      ...entry,
      requestId: entry.requestId || uuidv4(),
      sessionId: entry.sessionId || this.sessionId,
      args: redacted.value,
      argsSanitized: entry.argsSanitized || redacted.sanitized,
    };
    await this.rotateIfNeeded(auditPath);
    const line = `${JSON.stringify(normalized)}\n`;
    await this.adapter.append(auditPath, line);
  }

  private auditPath(): string {
    const configured = this.getSettings().auditLogPath || AUDIT_PATH;
    if (
      configured.startsWith("/") ||
      configured.startsWith("\\") ||
      configured.startsWith("..") ||
      /^[A-Z]:/i.test(configured)
    ) {
      throw new Error("Audit log path must be vault-relative.");
    }
    return configured.replace(/\\/g, "/");
  }

  private async ensureFolder(path: string): Promise<void> {
    const folder = path.split("/").slice(0, -1).join("/");
    if (!folder) return;
    if (!(await this.adapter.exists(folder))) {
      await this.adapter.mkdir(folder);
    }
  }

  private async rotateIfNeeded(auditPath: string): Promise<void> {
    if (!(await this.adapter.exists(auditPath))) {
      return;
    }
    const maxBytes = Math.max(1, this.getSettings().auditLogMaxSizeMb) * 1024 * 1024;
    const stat = await this.adapter.stat(auditPath);
    if (!stat || stat.size < maxBytes) {
      return;
    }

    if (await this.adapter.exists(`${auditPath}.3`)) {
      await this.adapter.remove(`${auditPath}.3`);
    }
    for (const index of [2, 1] as const) {
      const from = `${auditPath}.${index}`;
      if (await this.adapter.exists(from)) {
        await this.adapter.rename(from, `${auditPath}.${index + 1}`);
      }
    }
    await this.adapter.rename(auditPath, `${auditPath}.1`);
  }
}

export function redactSecrets(args: Record<string, unknown>): {
  value: Record<string, unknown>;
  sanitized: boolean;
} {
  let sanitized = false;

  const redactValue = (value: unknown, key?: string): unknown => {
    if (key && SECRET_KEY_PATTERN.test(key)) {
      sanitized = true;
      return "[REDACTED]";
    }
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item));
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          return JSON.stringify(redactValue(JSON.parse(value) as unknown));
        } catch {
          // Fall through to regex redaction.
        }
      }
      const redacted = value
        .replace(SECRET_VALUE_PATTERN, "[REDACTED]")
        .replace(BEARER_VALUE_PATTERN, "Bearer [REDACTED]");
      if (redacted !== value) sanitized = true;
      return redacted;
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
          entryKey,
          redactValue(entryValue, entryKey),
        ])
      );
    }
    return value;
  };

  return { value: redactValue(args) as Record<string, unknown>, sanitized };
}

export const AUDIT_LOG_PATH = AUDIT_PATH;
export const AUDIT_LOG_MAX_BYTES = MAX_BYTES;
