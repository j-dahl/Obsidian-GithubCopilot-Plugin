/* eslint-disable no-undef */
import { runDeviceFlow } from "../../src/auth/deviceFlow";
import { AuthError } from "../../src/auth/types";

const originalClientId = process.env.OBSIDIAN_COPILOT_AGENT_CLIENT_ID;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("runDeviceFlow", () => {
  beforeEach(() => {
    process.env.OBSIDIAN_COPILOT_AGENT_CLIENT_ID = "client-id";
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.OBSIDIAN_COPILOT_AGENT_CLIENT_ID = originalClientId;
  });

  test("completes full flow and increments interval on slow_down", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: "device",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ error: "slow_down" }))
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "ghu_device-token", token_type: "bearer" })
      );
    const progress: unknown[] = [];
    const promise = runDeviceFlow({ fetcher, showProgress: (p) => progress.push(p) });
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(6000);
    await expect(promise).resolves.toMatchObject({
      token: "ghu_device-token",
      source: "device-flow",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://github.com/login/device/code",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({ method: "POST" })
    );
    expect(progress).toEqual([
      expect.objectContaining({ userCode: "ABCD-1234", intervalSec: 1 }),
      expect.objectContaining({ userCode: "ABCD-1234", intervalSec: 6 }),
    ]);
  });

  test("continues on authorization_pending before success", async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: "device",
          user_code: "CODE",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "gho_success-token" }));
    const promise = runDeviceFlow({ fetcher, showProgress: jest.fn() });
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toMatchObject({ tokenType: "gho" });
  });

  test("maps expired and denied errors", async () => {
    const base = {
      device_code: "device",
      user_code: "CODE",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 1,
    };
    const expiredFetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(base))
      .mockResolvedValueOnce(jsonResponse({ error: "expired_token" }));
    const expired = runDeviceFlow({ fetcher: expiredFetch, showProgress: jest.fn() });
    const expiredExpectation = expect(expired).rejects.toMatchObject<Partial<AuthError>>({
      code: "device_flow_expired",
    });
    await jest.advanceTimersByTimeAsync(1000);
    await expiredExpectation;

    const deniedFetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(base))
      .mockResolvedValueOnce(jsonResponse({ error: "access_denied" }));
    const denied = runDeviceFlow({ fetcher: deniedFetch, showProgress: jest.fn() });
    const deniedExpectation = expect(denied).rejects.toMatchObject<Partial<AuthError>>({
      code: "device_flow_denied",
    });
    await jest.advanceTimersByTimeAsync(1000);
    await deniedExpectation;
  });

  test("respects abort signal", async () => {
    const fetcher = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockResolvedValueOnce(
      jsonResponse({
        device_code: "device",
        user_code: "CODE",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 10,
      })
    );
    const controller = new AbortController();
    const promise = runDeviceFlow({ fetcher, signal: controller.signal, showProgress: jest.fn() });
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(promise).rejects.toMatchObject<Partial<AuthError>>({
      code: "device_flow_aborted",
    });
  });

  test("throws typed disabled error without embedded client id", async () => {
    process.env.OBSIDIAN_COPILOT_AGENT_CLIENT_ID = "";
    await expect(runDeviceFlow({ showProgress: jest.fn() })).rejects.toMatchObject<
      Partial<AuthError>
    >({ code: "device_flow_disabled" });
  });
});
