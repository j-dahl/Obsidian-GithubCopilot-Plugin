import {
  AuthError,
  type AuthErrorDetails,
  type AuthResult,
  type CopilotSessionToken,
  type GitHubTokenType,
} from "./types";

export interface CopilotProviderSession {
  token: string;
  baseUrl: string;
}

export interface CopilotSessionTokenStoreOptions {
  fetcher?: typeof globalThis.fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Override headers sent during the GitHub-side exchange + user lookup.
   * Defaults identify as `GitHubCopilotCli/<ver>` for maximum compatibility,
   * matching the headers shipped by the real `@github/copilot` CLI.
   */
  exchangeHeaders?: ExchangeIdentity;
}

export interface ExchangeIdentity {
  userAgent: string;
  editorVersion: string;
  editorPluginVersion?: string;
  integrationId: string;
  apiVersion?: string;
}

export interface TokenRetryOptions {
  skipSources?: string[];
}

type TokenGetter = (opts?: TokenRetryOptions) => Promise<AuthResult | null>;

interface CopilotV2TokenResponse {
  token?: string;
  expires_at?: number;
  refresh_in?: number;
  endpoints?: { api?: string; proxy?: string; telemetry?: string };
  sku?: string;
  chat_enabled?: boolean;
}

interface CopilotUserResponse {
  login?: string;
  chat_enabled?: boolean;
  cli_enabled?: boolean;
  copilot_plan?: string;
  access_type_sku?: string;
  endpoints?: { api?: string; proxy?: string; telemetry?: string; ["origin-tracker"]?: string };
}

const GITHUB_API = "https://api.github.com";
const USER_ENDPOINT = `${GITHUB_API}/copilot_internal/user`;
const V2_TOKEN_ENDPOINT = `${GITHUB_API}/copilot_internal/v2/token`;
const SCOPE_PROBE_ENDPOINT = `${GITHUB_API}/user`;
const DEFAULT_API = "https://api.githubcopilot.com";
const DEFAULT_TIMEOUT_MS = 10000;
const USER_PATH_CACHE_MS = 25 * 60 * 1000;
const DEFAULT_IDENTITY: ExchangeIdentity = {
  userAgent: "GitHubCopilotCli/1.0.49",
  editorVersion: "copilot-cli/1.0.49",
  integrationId: "copilot-cli",
  apiVersion: "2026-01-09",
};

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

function parseV2Token(body: CopilotV2TokenResponse): CopilotSessionToken {
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

function parseUserResponse(body: CopilotUserResponse, oauthToken: string): CopilotSessionToken {
  const api = body.endpoints?.api ?? DEFAULT_API;
  if (body.chat_enabled === false) {
    throw new AuthError(
      "copilot_scope_missing",
      "GitHub returned a Copilot user record with chat_enabled=false. " +
        "Your account has a Copilot license but chat is disabled.",
      { httpStatus: 200, endpoint: USER_ENDPOINT, responseBody: JSON.stringify(body).slice(0, 800) }
    );
  }
  return {
    token: oauthToken,
    expiresAt: Date.now() + USER_PATH_CACHE_MS,
    refreshIn: USER_PATH_CACHE_MS / 1000,
    endpoints: {
      api,
      proxy: body.endpoints?.proxy,
      telemetry: body.endpoints?.telemetry,
    },
    sku: body.access_type_sku ?? body.copilot_plan ?? "unknown",
    chatEnabled: body.chat_enabled ?? true,
  };
}

function buildExchangeHeaders(
  identity: ExchangeIdentity,
  oauthToken: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${oauthToken}`,
    "User-Agent": identity.userAgent,
    "Editor-Version": identity.editorVersion,
    "Copilot-Integration-Id": identity.integrationId,
  };
  if (identity.editorPluginVersion) headers["Editor-Plugin-Version"] = identity.editorPluginVersion;
  if (identity.apiVersion) headers["X-GitHub-Api-Version"] = identity.apiVersion;
  return headers;
}

function tokenKindFor(auth: AuthResult): GitHubTokenType {
  return auth.tokenType;
}

export class CopilotSessionTokenStore {
  private readonly tokenGetter: TokenGetter;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;
  private readonly identity: ExchangeIdentity;
  private cached: CopilotSessionToken | null = null;
  private inFlight: Promise<CopilotSessionToken> | null = null;
  private refreshTimer: number | null = null;
  private scopeChecks: Array<{ token: string; check: Promise<void> }> = [];

  constructor(tokenGetter: TokenGetter, options: CopilotSessionTokenStoreOptions = {}) {
    this.tokenGetter = tokenGetter;
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.signal = options.signal;
    this.identity = { ...DEFAULT_IDENTITY, ...(options.exchangeHeaders ?? {}) };
  }

  async getValidSessionToken(): Promise<CopilotProviderSession> {
    const token = await this.getToken();
    return { token: token.token, baseUrl: token.endpoints.api ?? DEFAULT_API };
  }

  clear(): void {
    this.cached = null;
    this.scopeChecks = [];
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
    try {
      return await this.exchangeWithToken();
    } catch (error) {
      if (!(error instanceof AuthError) || error.code !== "copilot_scope_missing") throw error;
      if (!error.tokenSource || (error.httpStatus !== 401 && error.httpStatus !== 404)) throw error;
      return await this.exchangeWithToken([error.tokenSource]);
    }
  }

  private async exchangeWithToken(skipSources: string[] = []): Promise<CopilotSessionToken> {
    if (this.signal?.aborted) throw abortError();
    const oauth = await this.tokenGetter(skipSources.length > 0 ? { skipSources } : undefined);
    if (!oauth)
      throw new AuthError(
        "session_token_unavailable",
        "No GitHub token available; sign in via settings."
      );
    await this.ensureCopilotScope(oauth);
    const headers = buildExchangeHeaders(this.identity, oauth.token);
    const viaUser = await this.tryUserEndpoint(oauth, headers);
    if (viaUser) {
      this.cached = viaUser;
      this.scheduleRefresh(viaUser);
      return viaUser;
    }
    const viaV2 = await this.tryV2TokenEndpoint(oauth, headers);
    this.cached = viaV2;
    this.scheduleRefresh(viaV2);
    return viaV2;
  }

  /**
   * Primary path used by the real `@github/copilot` CLI: fetch the user record
   * to obtain the right CAPI base URL, and use the OAuth token directly as the
   * CAPI bearer. Returns null when the endpoint reports 404 so the caller can
   * fall back to the legacy `/copilot_internal/v2/token` JWT-exchange path.
   */
  private async tryUserEndpoint(
    oauth: AuthResult,
    headers: Record<string, string>
  ): Promise<CopilotSessionToken | null> {
    const request = requestSignal(this.signal, this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(USER_ENDPOINT, {
        method: "GET",
        headers,
        signal: request.signal,
      });
    } catch (cause) {
      if (request.signal.aborted) {
        throw new AuthError("http_timeout", "Copilot user request timed out.", {
          cause,
          endpoint: USER_ENDPOINT,
          tokenSource: oauth.source,
          tokenKind: tokenKindFor(oauth),
        });
      }
      throw new AuthError(
        "session_token_exchange_failed",
        `Network error calling ${USER_ENDPOINT}: ${errorMessage(cause)}`,
        {
          cause,
          endpoint: USER_ENDPOINT,
          tokenSource: oauth.source,
          tokenKind: tokenKindFor(oauth),
        }
      );
    } finally {
      request.cleanup();
    }
    if (response.status === 404) return null;
    if (response.status === 401) {
      const body = await readResponseBody(response);
      throw this.copilotScopeMissing({
        tokenSource: oauth.source,
        httpStatus: response.status,
        responseBody: body,
        endpoint: USER_ENDPOINT,
        tokenKind: tokenKindFor(oauth),
      });
    }
    if (!response.ok) {
      const body = await readResponseBody(response);
      throw new AuthError(
        "session_token_exchange_failed",
        `GitHub rejected ${USER_ENDPOINT} (HTTP ${response.status}) for token from ${oauth.source}. Response: ${body}`,
        {
          httpStatus: response.status,
          tokenSource: oauth.source,
          responseBody: body,
          endpoint: USER_ENDPOINT,
          tokenKind: tokenKindFor(oauth),
        }
      );
    }
    const body = (await response.json()) as CopilotUserResponse;
    return parseUserResponse(body, oauth.token);
  }

  /**
   * Legacy JWT-exchange path used by older VS Code Copilot Chat extensions.
   * Some token types (notably `ghu_` user-to-server tokens) still need this
   * to obtain a short-lived JWT instead of using the OAuth token directly.
   */
  private async tryV2TokenEndpoint(
    oauth: AuthResult,
    headers: Record<string, string>
  ): Promise<CopilotSessionToken> {
    const request = requestSignal(this.signal, this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(V2_TOKEN_ENDPOINT, {
        method: "GET",
        headers,
        signal: request.signal,
      });
    } catch (cause) {
      if (request.signal.aborted)
        throw new AuthError("http_timeout", "Copilot session token request timed out.", {
          cause,
          endpoint: V2_TOKEN_ENDPOINT,
          tokenSource: oauth.source,
          tokenKind: tokenKindFor(oauth),
        });
      throw new AuthError(
        "session_token_exchange_failed",
        `Network error calling ${V2_TOKEN_ENDPOINT}: ${errorMessage(cause)}`,
        {
          cause,
          endpoint: V2_TOKEN_ENDPOINT,
          tokenSource: oauth.source,
          tokenKind: tokenKindFor(oauth),
        }
      );
    } finally {
      request.cleanup();
    }
    if (!response.ok) {
      const body = await readResponseBody(response);
      if (response.status === 401 || response.status === 404) {
        throw this.copilotScopeMissing({
          tokenSource: oauth.source,
          httpStatus: response.status,
          responseBody: body,
          endpoint: V2_TOKEN_ENDPOINT,
          tokenKind: tokenKindFor(oauth),
        });
      }
      throw new AuthError(
        "session_token_exchange_failed",
        `GitHub rejected ${V2_TOKEN_ENDPOINT} (HTTP ${response.status}) for token from ${oauth.source}. Response: ${body}`,
        {
          httpStatus: response.status,
          tokenSource: oauth.source,
          responseBody: body,
          endpoint: V2_TOKEN_ENDPOINT,
          tokenKind: tokenKindFor(oauth),
        }
      );
    }
    return parseV2Token((await response.json()) as CopilotV2TokenResponse);
  }

  private async ensureCopilotScope(oauth: AuthResult): Promise<void> {
    const existing = this.scopeChecks.find((entry) => entry.token === oauth.token);
    if (existing) return existing.check;
    const check = this.fetchCopilotScope(oauth);
    this.scopeChecks.push({ token: oauth.token, check });
    return check;
  }

  private async fetchCopilotScope(oauth: AuthResult): Promise<void> {
    const request = requestSignal(this.signal, this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(SCOPE_PROBE_ENDPOINT, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${oauth.token}`,
          Accept: "application/json",
          "User-Agent": this.identity.userAgent,
        },
        signal: request.signal,
      });
    } catch (cause) {
      this.debugScopeHint(
        oauth.source,
        request.signal.aborted
          ? "scope inspection timed out; continuing to session exchange"
          : `scope inspection failed; continuing to session exchange: ${errorMessage(cause)}`
      );
      return;
    } finally {
      request.cleanup();
    }
    const scopes = response.headers
      .get("X-OAuth-Scopes")
      ?.split(",")
      .map((scope) => scope.trim().toLowerCase())
      .filter(Boolean);
    if (response.ok && scopes && scopes.length > 0 && !scopes.includes("copilot")) {
      throw this.copilotScopeMissing({
        tokenSource: oauth.source,
        httpStatus: response.status,
        endpoint: SCOPE_PROBE_ENDPOINT,
        responseBody: `X-OAuth-Scopes: ${scopes.join(", ")}`,
        tokenKind: tokenKindFor(oauth),
      });
    }
    if (!response.ok) {
      this.debugScopeHint(
        oauth.source,
        `scope inspection returned HTTP ${response.status}; continuing to session exchange`
      );
    } else if (!scopes || scopes.length === 0) {
      this.debugScopeHint(
        oauth.source,
        "scope inspection returned no X-OAuth-Scopes header; continuing to session exchange"
      );
    }
  }

  private debugScopeHint(tokenSource: string, message: string): void {
    console.debug(`[auth] copilot scope hint source=${tokenSource} ${message}`);
  }

  private copilotScopeMissing(details: AuthErrorDetails): AuthError {
    const status = details.httpStatus ?? "unknown";
    const body = details.responseBody ?? "";
    return new AuthError(
      "copilot_scope_missing",
      `Failed to exchange token from ${details.tokenSource} at ${details.endpoint} (HTTP ${status}). Response: ${body}`,
      details
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1000);
  } catch {
    return "<unavailable>";
  }
}
