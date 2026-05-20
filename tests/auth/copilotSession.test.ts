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
  } as Response;
}

function scopeResponse(scopes = "repo, copilot"): Response {
  return jsonResponse({ login: "test" }, 200, { "X-OAuth-Scopes": scopes });
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

  test("exchanges OAuth token and caches valid session token", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValue(jsonResponse(apiToken("session-1")));
    const getter = jest.fn(async () => oauth());
    const store = new CopilotSessionTokenStore(getter, { fetcher });
    await expect(store.getValidSessionToken()).resolves.toEqual({
      token: "session-1",
      baseUrl: "https://api.githubcopilot.com",
    });
    await expect(store.getValidSessionToken()).resolves.toEqual({
      token: "session-1",
      baseUrl: "https://api.githubcopilot.com",
    });
    expect(getter).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "token gho_oauth-token",
        Accept: "application/json",
      }),
    });
  });

  test("refreshes after expiry window", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(jsonResponse(apiToken("session-1", 120, 30)))
      .mockResolvedValueOnce(jsonResponse(apiToken("session-2", 3600, 120)));
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });
    await expect(store.getValidSessionToken()).resolves.toMatchObject({ token: "session-1" });
    await jest.advanceTimersByTimeAsync(30000);
    await expect(store.getValidSessionToken()).resolves.toMatchObject({ token: "session-2" });
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
    resolveFetch?.(jsonResponse(apiToken("deduped")));
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      { token: "deduped", baseUrl: "https://api.githubcopilot.com" },
      { token: "deduped", baseUrl: "https://api.githubcopilot.com" },
      { token: "deduped", baseUrl: "https://api.githubcopilot.com" },
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
        .mockResolvedValue(jsonResponse({ message: "no" }, 500)),
    });
    await expect(failing.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "session_token_exchange_failed",
      httpStatus: 500,
    });
  });

  test.each([404, 401])("maps HTTP %s during exchange to missing Copilot scope", async (status) => {
    const store = new CopilotSessionTokenStore(async () => oauth(), {
      fetcher: jest
        .fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce(scopeResponse())
        .mockResolvedValue(jsonResponse({ message: "no" }, status)),
    });
    await expect(store.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "copilot_scope_missing",
      httpStatus: status,
      tokenSource: "test",
    });
  });

  test("retries once with the next token source when exchange returns 404", async () => {
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
      .mockResolvedValueOnce(jsonResponse({ message: "no license" }, 404))
      .mockResolvedValueOnce(scopeResponse())
      .mockResolvedValueOnce(jsonResponse(apiToken("session-retry")));
    const store = new CopilotSessionTokenStore(getter, { fetcher });

    await expect(store.getValidSessionToken()).resolves.toMatchObject({ token: "session-retry" });
    expect(getter).toHaveBeenNthCalledWith(2, { skipSources: ["gh:auth-token"] });
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "token gho_good" }),
    });
  });

  test("/user inspection errors do not block the real exchange", async () => {
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockRejectedValueOnce(new Error("diagnostic down"))
      .mockResolvedValueOnce(jsonResponse(apiToken("session-after-user-error")));
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });

    await expect(store.getValidSessionToken()).resolves.toEqual({
      token: "session-after-user-error",
      baseUrl: "https://api.githubcopilot.com",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.github.com/user");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.github.com/copilot_internal/v2/token");
  });

  test("short-circuits when successful scope inspection clearly lacks copilot", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(scopeResponse("gist, repo"));
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });
    await expect(store.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "copilot_scope_missing",
      httpStatus: 200,
      tokenSource: "test",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.github.com/user");
  });

  test("successful scope inspection with copilot proceeds to exchange", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse("gist, repo, copilot"))
      .mockResolvedValueOnce(jsonResponse(apiToken("session-with-scope")));
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });

    await expect(store.getValidSessionToken()).resolves.toMatchObject({
      token: "session-with-scope",
    });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://api.github.com/user",
      "https://api.github.com/copilot_internal/v2/token",
    ]);
  });

  test("scope inspection result is cached for the OAuth token", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(scopeResponse("repo, copilot"))
      .mockResolvedValueOnce(jsonResponse(apiToken("session-1")))
      .mockResolvedValueOnce(jsonResponse(apiToken("session-2")));
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });

    await expect(store.getValidSessionToken()).resolves.toMatchObject({ token: "session-1" });
    (store as unknown as { cached: unknown }).cached = null;
    await expect(store.getValidSessionToken()).resolves.toMatchObject({ token: "session-2" });

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://api.github.com/user",
      "https://api.github.com/copilot_internal/v2/token",
      "https://api.github.com/copilot_internal/v2/token",
    ]);
  });
});
