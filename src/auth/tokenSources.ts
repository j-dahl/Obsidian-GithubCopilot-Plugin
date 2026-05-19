/* global process */
import { Buffer } from "node:buffer";
import { execFile as execFileCb } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { authResult, type AuthResult } from "./types";
import { externalAuthCachePath } from "./deviceFlow";
import { readWindowsCredentialManager } from "./windowsCredentialManager";

const execFile = promisify(execFileCb);
const ENV_VARS = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const;
const COPILOT_CANDIDATES = new Set([
  "config.json",
  "auth.json",
  "credentials.json",
  "lsp-config.json",
  "state.json",
]);
const TOKEN_KEYS = new Set(["oauth_token", "accessToken", "access_token", "token"]);
const TOKEN_PREFIX = /^(gho_|ghu_|github_pat_)/;

export interface VaultAdapterLike {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
}

export interface TokenSourceOptions {
  debug?: (message: string) => void;
  homeDir?: string;
  localAppData?: string;
  pluginCache?: { adapter: VaultAdapterLike; path?: string };
  signal?: AbortSignal;
}

interface FoundToken {
  token: string;
  path: string;
}

function debug(opts: TokenSourceOptions | undefined, tier: number, message: string): void {
  (opts?.debug ?? console.debug)(`[auth] tier=${tier} ${message}`);
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
}

function findToken(value: unknown, path = "$"): FoundToken | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findToken(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (TOKEN_KEYS.has(key) && typeof child === "string" && TOKEN_PREFIX.test(child))
      return { token: child, path: `${path}.${key}` };
    const found = findToken(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function tokenFromPayload(payload: string): string | null {
  const trimmed = payload.trim();
  if (TOKEN_PREFIX.test(trimmed)) return trimmed;
  try {
    const found = findToken(JSON.parse(trimmed) as unknown);
    return found?.token ?? null;
  } catch {
    return null;
  }
}

async function tier1Env(opts?: TokenSourceOptions): Promise<AuthResult | null> {
  for (const name of ENV_VARS) {
    ensureNotAborted(opts?.signal);
    const result = authResult(process.env[name] ?? "", `env:${name}`);
    if (result) {
      debug(opts, 1, `source=${result.source} ok`);
      return result;
    }
  }
  debug(opts, 1, "skipped reason=no-env-token");
  return null;
}

async function tier2GhCli(opts?: TokenSourceOptions): Promise<AuthResult | null> {
  ensureNotAborted(opts?.signal);
  try {
    const { stdout } = await execFile("gh", ["auth", "token", "--hostname", "github.com"], {
      timeout: 5000,
    });
    const result = authResult(stdout.trim(), "gh:auth-token");
    if (result) {
      debug(opts, 2, `source=${result.source} ok`);
      return result;
    }
    debug(opts, 2, "skipped reason=empty-or-unsupported-token");
  } catch {
    debug(opts, 2, "skipped reason=gh-unavailable");
  }
  return null;
}

async function tier2CopilotCliExec(opts?: TokenSourceOptions): Promise<AuthResult | null> {
  for (const [file, args] of [
    ["copilot", ["auth", "token"]],
    ["gh", ["copilot", "auth", "token"]],
  ] as const) {
    ensureNotAborted(opts?.signal);
    try {
      const { stdout } = await execFile(file, args, { timeout: 5000 });
      const token = tokenFromPayload(stdout);
      const result = token ? authResult(token, "copilot-cli:cli-print") : null;
      if (result) {
        debug(opts, 2, `source=${result.source} ok`);
        return result;
      }
    } catch {
      // Try the next CLI spelling.
    }
  }
  debug(opts, 2, "skipped reason=copilot-cli-token-command-unavailable");
  return null;
}

async function tier3CopilotCliKeychain(opts?: TokenSourceOptions): Promise<AuthResult | null> {
  const os = platform();
  if (os === "win32") {
    try {
      const credentials = await readWindowsCredentialManager("copilot-cli/*");
      for (const credential of credentials) {
        ensureNotAborted(opts?.signal);
        const token = tokenFromPayload(credential.password);
        const result = token
          ? authResult(token, `copilot-cli:cred-manager:${credential.target}`)
          : null;
        if (result) return result;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (os === "darwin") {
    try {
      const { stderr } = await execFile(
        "security",
        ["find-generic-password", "-s", "copilot-cli", "-g"],
        { timeout: 5000 }
      );
      const accounts = Array.from(
        stderr.matchAll(/"acct"<blob>="([^"]+)"/g),
        (match) => match[1]
      ).filter((account): account is string => Boolean(account));
      const accountArgs = accounts.length > 0 ? accounts : [""];
      for (const account of accountArgs) {
        ensureNotAborted(opts?.signal);
        const args = ["find-generic-password", "-s", "copilot-cli"];
        if (account) args.push("-a", account);
        args.push("-w");
        try {
          const { stdout } = await execFile("security", args, { timeout: 5000 });
          const token = tokenFromPayload(stdout);
          const result = token
            ? authResult(token, `copilot-cli:keychain:${account || "copilot-cli"}`)
            : null;
          if (result) return result;
        } catch {
          // Try the next account.
        }
      }
    } catch {
      try {
        const { stdout } = await execFile(
          "security",
          ["find-generic-password", "-s", "copilot-cli", "-w"],
          { timeout: 5000 }
        );
        const token = tokenFromPayload(stdout);
        return token ? authResult(token, "copilot-cli:keychain:copilot-cli") : null;
      } catch {
        return null;
      }
    }
    return null;
  }
  try {
    const { stdout } = await execFile("secret-tool", ["lookup", "service", "copilot-cli"], {
      timeout: 5000,
    });
    const token = tokenFromPayload(stdout);
    if (token) return authResult(token, "copilot-cli:libsecret");
  } catch {
    // Fall through to search output parsing below.
  }
  try {
    const { stdout } = await execFile(
      "secret-tool",
      ["search", "--all", "service", "copilot-cli"],
      {
        timeout: 5000,
      }
    );
    for (const line of stdout.split(/\r?\n/)) {
      const token = tokenFromPayload(line);
      const result = token ? authResult(token, "copilot-cli:libsecret") : null;
      if (result) return result;
    }
  } catch {
    // libsecret is unavailable or has no matching item.
  }
  return null;
}

async function tier3CopilotCli(opts?: TokenSourceOptions): Promise<AuthResult | null> {
  ensureNotAborted(opts?.signal);
  const keychainResult = await tier3CopilotCliKeychain(opts);
  if (keychainResult) {
    debug(opts, 3, `source=${keychainResult.source} ok`);
    return keychainResult;
  }
  const dir = join(opts?.homeDir ?? homedir(), ".copilot");
  if (!existsSync(dir)) {
    debug(opts, 3, "skipped reason=no-copilot-dir");
    return null;
  }
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => COPILOT_CANDIDATES.has(name));
  } catch {
    debug(opts, 3, "skipped reason=cannot-read-copilot-dir");
    return null;
  }
  for (const name of names) {
    ensureNotAborted(opts?.signal);
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
      const found = findToken(parsed);
      const result = found ? authResult(found.token, `copilot-cli:${name}:${found.path}`) : null;
      if (result) {
        debug(opts, 3, `source=${result.source} ok`);
        return result;
      }
    } catch {
      // Try the next candidate.
    }
  }
  debug(opts, 3, "skipped reason=no-token-in-copilot-files");
  return null;
}

function vscodeCopilotBase(opts?: TokenSourceOptions): string {
  if (platform() === "win32")
    return join(opts?.localAppData ?? process.env.LOCALAPPDATA ?? "", "github-copilot");
  return join(opts?.homeDir ?? homedir(), ".config", "github-copilot");
}

async function tier4VsCodeCopilot(opts?: TokenSourceOptions): Promise<AuthResult | null> {
  const base = vscodeCopilotBase(opts);
  for (const file of ["hosts.json", "apps.json"]) {
    ensureNotAborted(opts?.signal);
    const fullPath = join(base, file);
    if (!existsSync(fullPath)) continue;
    try {
      const data = JSON.parse(readFileSync(fullPath, "utf8")) as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (!key.includes("github.com")) continue;
        const found = findToken(value, `$.${key}`);
        const result = found ? authResult(found.token, `copilot-file:${file}`) : null;
        if (result) {
          debug(opts, 4, `source=${result.source} ok`);
          return result;
        }
      }
    } catch {
      // Try the next file.
    }
  }
  debug(opts, 4, "skipped reason=no-vscode-copilot-token");
  return null;
}

async function decodePluginCache(raw: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(raw) as { encrypted?: unknown; data?: unknown };
    if (parsed.encrypted === true && typeof parsed.data === "string") {
      const electron = (await import("electron")) as {
        safeStorage?: { decryptString?(buffer: Buffer): string };
      };
      return electron.safeStorage?.decryptString?.(Buffer.from(parsed.data, "base64")) ?? null;
    }
  } catch {
    return raw;
  }
  return raw;
}
async function tier5PluginCache(opts?: TokenSourceOptions): Promise<AuthResult | null> {
  const cache = opts?.pluginCache;
  if (!cache) {
    if (opts?.homeDir || opts?.localAppData) {
      debug(opts, 5, "skipped reason=no-plugin-cache");
      return null;
    }
    try {
      const fullPath = externalAuthCachePath();
      if (!existsSync(fullPath)) {
        debug(opts, 5, "skipped reason=no-external-cache-file");
        return null;
      }
      const decoded = await decodePluginCache(readFileSync(fullPath, "utf8"));
      if (!decoded) return null;
      const parsed = JSON.parse(decoded) as { token?: unknown };
      const result =
        typeof parsed.token === "string" ? authResult(parsed.token, "plugin:cache") : null;
      if (result) debug(opts, 5, `source=${result.source} ok`);
      return result;
    } catch {
      debug(opts, 5, "skipped reason=external-cache-unreadable");
      return null;
    }
  }
  const path = cache.path ?? ".obsidian/plugins/github-copilot-agent/oauth-cache.json"; // eslint-disable-line obsidianmd/hardcoded-config-path
  try {
    if (!(await cache.adapter.exists(path))) {
      debug(opts, 5, "skipped reason=no-cache-file");
      return null;
    }
    const decoded = await decodePluginCache(await cache.adapter.read(path));
    if (!decoded) {
      debug(opts, 5, "skipped reason=cache-encrypted-unavailable");
      return null;
    }
    const parsed = JSON.parse(decoded) as { token?: unknown };
    const result =
      typeof parsed.token === "string" ? authResult(parsed.token, "plugin:cache") : null;
    if (result) {
      try {
        rmSync(path, { force: true });
      } catch {
        // Ignore migration cleanup failures.
      }
      debug(opts, 5, `source=${result.source} ok`);
      return result;
    }
  } catch {
    debug(opts, 5, "skipped reason=cache-unreadable");
    return null;
  }
  debug(opts, 5, "skipped reason=no-cache-token");
  return null;
}

export async function getGitHubToken(opts: TokenSourceOptions = {}): Promise<AuthResult | null> {
  return (
    (await tier1Env(opts)) ??
    (await tier2GhCli(opts)) ??
    (await tier2CopilotCliExec(opts)) ??
    (await tier3CopilotCli(opts)) ??
    (await tier4VsCodeCopilot(opts)) ??
    (await tier5PluginCache(opts))
  );
}

export const tokenSourceInternals = { findToken, tokenFromPayload };
