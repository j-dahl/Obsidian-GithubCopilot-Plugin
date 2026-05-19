/* global process */
import { Buffer } from "node:buffer";
import { dirname } from "node:path";
import type { AuthResult, DeviceFlowProgress } from "./types";
import { AuthError, authResult } from "./types";

export interface WritableVaultAdapterLike {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write?(path: string, data: string): Promise<void>;
  append?(path: string, data: string): Promise<void>;
  read?(path: string): Promise<string>;
}

export interface DeviceFlowOptions {
  showProgress: (progress: DeviceFlowProgress) => void;
  signal?: AbortSignal;
  fetcher?: typeof globalThis.fetch;
  timeoutMs?: number;
  cache?: { adapter: WritableVaultAdapterLike; path?: string; warn?: (message: string) => void };
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEFAULT_TIMEOUT_MS = 10000;
const CACHE_PATH = ".obsidian/plugins/github-copilot-agent/oauth-cache.json"; // eslint-disable-line obsidianmd/hardcoded-config-path

function clientId(): string {
  return (process.env.OBSIDIAN_COPILOT_AGENT_CLIENT_ID ?? "").trim();
}

function abortError(): AuthError {
  return new AuthError("device_flow_aborted", "GitHub device flow was canceled.");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function timeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort(new AuthError("http_timeout", "GitHub authentication request timed out."));
  }, timeoutMs);
  const onAbort = () => controller.abort(parent?.reason ?? abortError());
  parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
      if (timedOut) throw new AuthError("http_timeout", "GitHub authentication request timed out.");
    },
  };
}

async function postForm<T>(
  url: string,
  body: URLSearchParams,
  opts: DeviceFlowOptions
): Promise<T> {
  throwIfAborted(opts.signal);
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const timeout = timeoutSignal(opts.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: timeout.signal,
    });
  } catch (cause) {
    if (opts.signal?.aborted) throw abortError();
    if (timeout.signal.aborted)
      throw new AuthError("http_timeout", "GitHub authentication request timed out.", { cause });
    throw new AuthError("device_flow_error", "GitHub authentication request failed.", { cause });
  } finally {
    timeout.cleanup();
  }
  if (!response.ok) {
    throw new AuthError(
      url === DEVICE_CODE_URL ? "device_code_request_failed" : "device_flow_error",
      "GitHub authentication request failed.",
      { httpStatus: response.status }
    );
  }
  return (await response.json()) as T;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function ensureFolder(adapter: WritableVaultAdapterLike, path: string): Promise<void> {
  const parts = dirname(path).split(/[\\/]/).filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) await adapter.mkdir(current);
  }
}

async function maybeEncrypt(payload: string, warn?: (message: string) => void): Promise<string> {
  try {
    const electron = (await import("electron")) as {
      safeStorage?: { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer };
    };
    if (electron.safeStorage?.isEncryptionAvailable()) {
      return JSON.stringify({
        encrypted: true,
        data: electron.safeStorage.encryptString(payload).toString("base64"),
      });
    }
  } catch {
    // Electron safeStorage is unavailable in tests or non-Electron contexts.
  }
  warn?.("[auth] OAuth cache stored in plaintext because Electron safeStorage is unavailable.");
  return payload;
}

async function cacheToken(token: string, opts: DeviceFlowOptions): Promise<void> {
  const cache = opts.cache;
  if (!cache) return;
  const path = cache.path ?? CACHE_PATH;
  const payload = JSON.stringify({ token, createdAt: new Date().toISOString() });
  const data = await maybeEncrypt(payload, cache.warn);
  await ensureFolder(cache.adapter, path);
  if (cache.adapter.write) await cache.adapter.write(path, data);
  else if (cache.adapter.append) await cache.adapter.append(path, data);
}

export async function runDeviceFlow(opts: DeviceFlowOptions): Promise<AuthResult> {
  const id = clientId();
  if (!id) {
    throw new AuthError(
      "device_flow_disabled",
      "GitHub device flow is disabled because no OAuth client ID was embedded. Provide a token with COPILOT_GITHUB_TOKEN, GH_TOKEN, GITHUB_TOKEN, or gh auth login."
    );
  }
  const device = await postForm<DeviceCodeResponse>(
    DEVICE_CODE_URL,
    new URLSearchParams({
      client_id: id,
      scope: "read:user copilot models:read",
    }),
    opts
  );
  opts.showProgress({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresInSec: device.expires_in,
    intervalSec: device.interval,
  });
  let intervalSec = device.interval;
  const expiresAt = Date.now() + device.expires_in * 1000;
  while (Date.now() < expiresAt) {
    await sleep(intervalSec * 1000, opts.signal);
    const response = await postForm<AccessTokenResponse>(
      ACCESS_TOKEN_URL,
      new URLSearchParams({
        client_id: id,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      opts
    );
    if (response.access_token) {
      const result = authResult(response.access_token, "device-flow");
      if (!result)
        throw new AuthError("invalid_response", "GitHub returned an unsupported token type.");
      await cacheToken(result.token, opts);
      return result;
    }
    switch (response.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        intervalSec += 5;
        opts.showProgress({
          userCode: device.user_code,
          verificationUri: device.verification_uri,
          expiresInSec: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
          intervalSec,
        });
        break;
      case "expired_token":
        throw new AuthError("device_flow_expired", "GitHub device flow code expired.");
      case "access_denied":
        throw new AuthError("device_flow_denied", "GitHub device flow was denied.");
      default:
        throw new AuthError(
          "device_flow_error",
          response.error_description ?? "GitHub device flow failed."
        );
    }
  }
  throw new AuthError("device_flow_expired", "GitHub device flow code expired.");
}
