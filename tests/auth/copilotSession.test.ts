/* eslint-disable no-undef, @typescript-eslint/no-unsafe-assignment */
import { CopilotSessionTokenStore } from "../../src/auth/copilotSession";
import { AuthError, type AuthResult } from "../../src/auth/types";

function oauth(): AuthResult {
  return { token: "gho_oauth-token", source: "test", tokenType: "gho" };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
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

  afterEach(() => jest.useRealTimers());

  test("exchanges OAuth token and caches valid session token", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
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
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
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
      .mockResolvedValueOnce(jsonResponse(apiToken("session-1", 120, 30)))
      .mockResolvedValueOnce(jsonResponse(apiToken("session-2", 3600, 120)));
    const store = new CopilotSessionTokenStore(async () => oauth(), { fetcher });
    await expect(store.getValidSessionToken()).resolves.toMatchObject({ token: "session-1" });
    await jest.advanceTimersByTimeAsync(30000);
    await expect(store.getValidSessionToken()).resolves.toMatchObject({ token: "session-2" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("deduplicates concurrent session token requests", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetcher = jest.fn<Promise<Response>, Parameters<typeof fetch>>(
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
    expect(resolveFetch).toBeDefined();
    resolveFetch?.(jsonResponse(apiToken("deduped")));
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      { token: "deduped", baseUrl: "https://api.githubcopilot.com" },
      { token: "deduped", baseUrl: "https://api.githubcopilot.com" },
      { token: "deduped", baseUrl: "https://api.githubcopilot.com" },
    ]);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("throws typed errors for missing OAuth and HTTP failure", async () => {
    const missing = new CopilotSessionTokenStore(async () => null, { fetcher: jest.fn() });
    await expect(missing.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "session_token_unavailable",
    });
    const failing = new CopilotSessionTokenStore(async () => oauth(), {
      fetcher: jest
        .fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValue(jsonResponse({ message: "no" }, 401)),
    });
    await expect(failing.getValidSessionToken()).rejects.toMatchObject<Partial<AuthError>>({
      code: "session_token_exchange_failed",
      httpStatus: 401,
    });
  });
});
