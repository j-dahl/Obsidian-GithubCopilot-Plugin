/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { CopilotSessionTokenStore } from "../../src/auth/copilotSession";
import { AuthError, type AuthResult } from "../../src/auth/types";

function oauth(): AuthResult {
  return { token: "gho_oauth-token", source: "test", tokenType: "gho" };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function scopeResponse(scopes = "repo, copilot"): Response {
  return jsonResponse({ login: "test" }, 200, { "X-OAuth-Scopes": scopes });
}

function userBody(api = "https://api.enterprise.githubcopilot.com"): unknown {
  return {
    login: "test",
    chat_enabled: true,
    cli_enabled: true,
    copilot_plan: "enterprise",
    access_type_sku: "copilot_enterprise_seat_quota",
    endpoints: { api, proxy: "https://copilot-proxy.githubusercontent.com" },
  };
}

function apiToken(token: string, expiresInSec = 3600, refreshIn = 120): unknown {
  return {
    token,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
    refresh_in: refreshIn,
    endpoints: { api: "https://api.githubcopilot.com" },
    sku: "free",
    chat_enabled: true,
  };
}

describe("CopilotSessionTokenStore", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("uses /copilot_internal/user and returns OAuth token as bearer", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(jsonResponse(userBody()));
    const getter = jest.fn(async () => oauth());
    const store = new CopilotSessionTokenStore(getter, { fetcher });

    await expect(store.getValidSessionToken()).resolves.toEqual({
      token: "gho_oauth-token",
      baseUrl: "https://api.enterprise.githubcopilot.com",
    });
    // Cached on second call
    await expect(store.getValidSessionToken()).resolves.toEqual({
      token: "gho_oauth-token",
      baseUrl: "https://api.enterprise.githubcopilot.com",
    });
    expect(getter).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.github.com/copilot_internal/user");
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({
        Authorization: "Bearer gho_oauth-token",
        Accept: "application/json",
        "Copilot-Integration-Id": "copilot-cli",
        "User-Agent": expect.stringContaining("GitHubCopilotCli/"),
        "Editor-Version": expect.stringContaining("copilot-cli/"),
        "X-GitHub-Api-Version": "2026-01-09",
      }),
    });
  });

  test("falls back to legacy /v2/token when /copilot_internal/user returns 404", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404))
      .mockResolvedValueOnce(jsonResponse(apiToken("legacy-jwt")));
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });

    await expect(store.getValidSessionToken()).resolves.toEqual({
      token: "legacy-jwt",
      baseUrl: "https://api.githubcopilot.com",
    });
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      "https://api.github.com/user",
      "https://api.github.com/copilot_internal/user",
      "https://api.github.com/copilot_internal/v2/token",
    ]);
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer gho_oauth-token" }),
    });
  });

  test("refreshes after the user-path cache window expires", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(jsonResponse(userBody()))
      .mockResolvedValueOnce(jsonResponse(userBody("https://api.githubcopilot.com")));
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });

    const first = await store.getValidSessionToken();
    expect(first.baseUrl).toBe("https://api.enterprise.githubcopilot.com");
    // user-path cache expires in 25 minutes; refresh timer fires ~24min in.
    await jest.advanceTimersByTimeAsync(26 * 60 * 1000);
    const second = await store.getValidSessionToken();
    expect(second.baseUrl).toBe("https://api.githubcopilot.com");
    // scope probe is cached per OAuth token, so refresh only re-fetches /copilot_internal/user.
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test("deduplicates concurrent session token requests", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse())
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          })
      );
    const getter = jest.fn(async () => oauth());
    const store = new CopilotSessionTokenStore(getter, { fetcher });
    const first = store.getValidSessionToken();
    const second = store.getValidSessionToken();
    const third = store.getValidSessionToken();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(resolveFetch).toBeDefined();
    resolveFetch?.(jsonResponse(userBody("https://api.githubcopilot.com")));
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      { token: "gho_oauth-token", baseUrl: "https://api.githubcopilot.com" },
      { token: "gho_oauth-token", baseUrl: "https://api.githubcopilot.com" },
      { token: "gho_oauth-token", baseUrl: "https://api.githubcopilot.com" },
    ]);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("throws typed errors for missing OAuth and HTTP failure", async () => {
    const missing = new CopilotSessionTokenStore(async () => null, { fetcher: jest.fn() });
    await expect(missing.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "session_token_unavailable",
    });
    const failing = new CopilotSessionTokenStore(async () => oauth(), {
      fetcher: jest
        .fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce(scopeResponse())
        .mockResolvedValueOnce(jsonResponse({ message: "boom" }, 500)),
    });
    await expect(failing.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "session_token_exchange_failed",
      httpStatus: 500,
      endpoint: "https://api.github.com/copilot_internal/user",
    });
  });

  test("HTTP 401 during /copilot_internal/user is mapped to copilot_scope_missing", async () => {
    const store = new CopilotSessionTokenStore(
      async (opts?: { skipSources?: string[] }) =>
        opts?.skipSources?.includes("test") ? null : oauth(),
      {
        fetcher: jest
          .fn<Promise<Response>, Parameters<typeof fetch>>()
          .mockResolvedValueOnce(scopeResponse())
          .mockResolvedValueOnce(jsonResponse({ message: "no" }, 401)),
      }
    );
    await expect(store.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "session_token_unavailable",
    });
  });

  test("HTTP 401 in legacy fallback /v2/token is mapped to copilot_scope_missing", async () => {
    const store = new CopilotSessionTokenStore(
      async (opts?: { skipSources?: string[] }) =>
        opts?.skipSources?.includes("test") ? null : oauth(),
      {
        fetcher: jest
          .fn<Promise<Response>, Parameters<typeof fetch>>()
          .mockResolvedValueOnce(scopeResponse())
          .mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404))
          .mockResolvedValueOnce(jsonResponse({ message: "denied" }, 401)),
      }
    );
    await expect(store.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "session_token_unavailable",
    });
  });

  test("HTTP 401 on /copilot_internal/user surfaces scope_missing when retry also fails the same way", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(jsonResponse({ message: "no" }, 401))
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(jsonResponse({ message: "no again" }, 401));
    let call = 0;
    const store = new CopilotSessionTokenStore(
      async () => ({
        token: call++ === 0 ? "gho_first" : "gho_second",
        source: call === 1 ? "src-a" : "src-b",
        tokenType: "gho",
      }),
      { fetcher }
    );
    await expect(store.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "copilot_scope_missing",
      httpStatus: 401,
      endpoint: "https://api.github.com/copilot_internal/user",
    });
  });

  test("retries once with the next token source when scope-missing has tokenSource", async () => {
    const first = {
      token: "gho_bad",
      source: "gh:auth-token",
      tokenType: "gho",
    } satisfies AuthResult;
    const second = {
      token: "gho_good",
      source: "copilot-cli:cred-manager:github.com",
      tokenType: "gho",
    } satisfies AuthResult;
    const getter = jest.fn(async (opts?: { skipSources?: string[] }) =>
      opts?.skipSources?.includes("gh:auth-token") ? second : first
    );
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(jsonResponse({ message: "no license" }, 401))
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(jsonResponse(userBody("https://api.githubcopilot.com")));
    const store = new CopilotSessionTokenStore(getter, { fetcher });

    const session = await store.getValidSessionToken();
    expect(session).toEqual({
      token: "gho_good",
      baseUrl: "https://api.githubcopilot.com",
    });
    expect(getter).toHaveBeenNthCalledWith(2, { skipSources: ["gh:auth-token"] });
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer gho_good" }),
    });
  });

  test("short-circuits when scope inspection clearly lacks copilot", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse("gist, repo"));
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });
    await expect(store.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "copilot_scope_missing",
      httpStatus: 200,
      tokenSource: "test",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.github.com/user");
  });

  test("scope inspection error does not block the real exchange", async () => {
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockRejectedValueOnce(new Error("diagnostic down"))
      .mockResolvedValueOnce(jsonResponse(userBody()));
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });

    await expect(store.getValidSessionToken()).resolves.toEqual({
      token: "gho_oauth-token",
      baseUrl: "https://api.enterprise.githubcopilot.com",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.github.com/user");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.github.com/copilot_internal/user");
  });

  test("chat_enabled=false in /copilot_internal/user response is reported as scope missing", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          login: "test",
          chat_enabled: false,
          copilot_plan: "free",
          endpoints: { api: "https://api.githubcopilot.com" },
        })
      );
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });
    await expect(store.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "copilot_scope_missing",
      httpStatus: 200,
      endpoint: "https://api.github.com/copilot_internal/user",
    });
  });

  test("custom ExchangeIdentity overrides defaults", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(jsonResponse(userBody()));
    const store = new CopilotSessionTokenStore(async () => oauth(), {
      fetcher,
      exchangeHeaders: {
        userAgent: "Custom/9.9.9",
        editorVersion: "obsidian/1.0.0",
        editorPluginVersion: "github-copilot-agent/0.1.0",
        integrationId: "vscode-chat",
        apiVersion: "2025-01-01",
      },
    });
    await store.getValidSessionToken();
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "User-Agent": "Custom/9.9.9",
        "Editor-Version": "obsidian/1.0.0",
        "Editor-Plugin-Version": "github-copilot-agent/0.1.0",
        "Copilot-Integration-Id": "vscode-chat",
        "X-GitHub-Api-Version": "2025-01-01",
      }),
    });
  });
});
