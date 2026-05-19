import { FALLBACK_COPILOT_MODELS, getCopilotModels } from "../../src/providers/copilotModels";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("getCopilotModels", () => {
  test("fetches live picker models using a Copilot session token", async () => {
    const fetcher = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockResolvedValue(
      response({
        data: [
          {
            id: "gpt-4o",
            model_picker_enabled: true,
            capabilities: { supports: { tool_calls: true } },
          },
          {
            id: "hidden",
            model_picker_enabled: false,
            capabilities: { supports: { tool_calls: true } },
          },
          {
            id: "no-tools",
            model_picker_enabled: true,
            capabilities: { supports: { tool_calls: false } },
          },
        ],
      })
    );

    await expect(
      getCopilotModels(
        {
          async getValidSessionToken() {
            return { token: "session", baseUrl: "https://api.githubcopilot.com" };
          },
        },
        fetcher
      )
    ).resolves.toEqual({ models: ["gpt-4o"], source: "live" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.githubcopilot.com/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer session" }),
      })
    );
  });

  test("falls back when live models are unavailable", async () => {
    await expect(
      getCopilotModels(
        {
          async getValidSessionToken() {
            throw new Error("scope missing");
          },
        },
        jest.fn()
      )
    ).resolves.toEqual({ models: FALLBACK_COPILOT_MODELS, source: "fallback" });
  });
});
