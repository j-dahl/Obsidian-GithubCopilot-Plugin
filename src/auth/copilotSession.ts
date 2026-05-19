import { AuthError, type AuthResult, type CopilotSessionToken } from "./types";

export interface CopilotProviderSession {
  token: string;
  baseUrl: string;
}

export interface CopilotSessionTokenStoreOptions {
  fetcher?: typeof globalThis.fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

type TokenGetter = () => Promise<AuthResult | null>;

interface CopilotTokenApiResponse {
  token?: string;
  expires_at?: number;
  refresh_in?: number;
  endpoints?: { api?: string; proxy?: string; telemetry?: string };
  sku?: string;
  chat_enabled?: boolean;
}

const TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const DEFAULT_API = "https://api.githubcopilot.com";
const DEFAULT_TIMEOUT_MS = 10000;

function abortError(): AuthError {
  return new AuthError(
    "session_token_exchange_failed",
    "Copilot session token request was aborted."
  );
}

function requestSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () =>
      controller.abort(new AuthError("http_timeout", "Copilot session token request timed out.")),
    timeoutMs
  );
  const onAbort = () => controller.abort(parent?.reason ?? abortError());
  parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

function parseSessionToken(body: CopilotTokenApiResponse): CopilotSessionToken {
  if (!body.token || !body.expires_at || !body.refresh_in) {
    throw new AuthError(
      "invalid_response",
      "GitHub Copilot token response was missing required fields."
    );
  }
  return {
    token: body.token,
    expiresAt: body.expires_at * 1000,
    refreshIn: body.refresh_in,
    endpoints: {
      api: body.endpoints?.api ?? DEFAULT_API,
      proxy: body.endpoints?.proxy,
      telemetry: body.endpoints?.telemetry,
    },
    sku: body.sku ?? "unknown",
    chatEnabled: body.chat_enabled ?? true,
  };
}

export class CopilotSessionTokenStore {
  private readonly tokenGetter: TokenGetter;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;
  private cached: CopilotSessionToken | null = null;
  private inFlight: Promise<CopilotSessionToken> | null = null;
  private refreshTimer: number | null = null;

  constructor(tokenGetter: TokenGetter, options: CopilotSessionTokenStoreOptions = {}) {
    this.tokenGetter = tokenGetter;
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.signal = options.signal;
  }

  async getValidSessionToken(): Promise<CopilotProviderSession> {
    const token = await this.getToken();
    return { token: token.token, baseUrl: token.endpoints.api ?? DEFAULT_API };
  }

  clear(): void {
    this.cached = null;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private async getToken(): Promise<CopilotSessionToken> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60000) return this.cached;
    if (!this.inFlight) {
      this.inFlight = this.exchange().finally(() => {
        this.inFlight = null;
      });
    }
    return await this.inFlight;
  }

  private scheduleRefresh(token: CopilotSessionToken): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    const refreshAt = Math.min(token.expiresAt - 60000, Date.now() + token.refreshIn * 1000);
    const delayMs = Math.max(0, refreshAt - Date.now());
    this.refreshTimer = window.setTimeout(() => {
      this.inFlight = this.exchange()
        .catch((cause) => {
          if (this.cached) return this.cached;
          throw new AuthError(
            "session_token_exchange_failed",
            "Scheduled Copilot session token refresh failed.",
            { cause }
          );
        })
        .finally(() => {
          this.inFlight = null;
        });
    }, delayMs);
  }

  private async exchange(): Promise<CopilotSessionToken> {
    if (this.signal?.aborted) throw abortError();
    const oauth = await this.tokenGetter();
    if (!oauth)
      throw new AuthError(
        "session_token_unavailable",
        "No GitHub token available; sign in via settings."
      );
    const request = requestSignal(this.signal, this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(TOKEN_URL, {
        method: "POST",
        headers: { Authorization: `token ${oauth.token}`, Accept: "application/json" },
        signal: request.signal,
      });
    } catch (cause) {
      if (request.signal.aborted)
        throw new AuthError("http_timeout", "Copilot session token request timed out.", { cause });
      throw new AuthError(
        "session_token_exchange_failed",
        "Failed to exchange GitHub token for a Copilot session token.",
        { cause }
      );
    } finally {
      request.cleanup();
    }
    if (!response.ok) {
      throw new AuthError(
        "session_token_exchange_failed",
        "GitHub rejected the Copilot session token request.",
        { httpStatus: response.status }
      );
    }
    const parsed = parseSessionToken((await response.json()) as CopilotTokenApiResponse);
    this.cached = parsed;
    this.scheduleRefresh(parsed);
    return parsed;
  }
}
