import "openai/shims/node";
/* global describe, expect, test */
import {
  GitHubCopilotProvider,
  ProviderError,
  type ChatCompletionChunk,
  type CopilotSessionTokenStore,
} from "../../src/providers";
import {
  completionResponse,
  createJsonFetch,
  createStreamingFetch,
  streamingResponse,
} from "./helpers";

function tokenStore(): CopilotSessionTokenStore {
  return {
    async getValidSessionToken(): Promise<{ token: string; baseUrl: string }> {
      return { token: "tid=session", baseUrl: "https://api.business.githubcopilot.com" };
    },
  };
}

describe("GitHubCopilotProvider", () => {
  test("uses the session endpoint and required Copilot headers", async () => {
    const fetcher = createJsonFetch(completionResponse("gpt-4.1"));
    const provider = new GitHubCopilotProvider({
      model: "gpt-4.1",
      sessionTokenStore: tokenStore(),
      obsidianVersion: "1.8.0",
      pluginVersion: "0.1.0",
      fetcher,
    });

    await provider.complete({ messages: [{ role: "user", content: "hi" }] });

    const request = fetcher.requests[0];
    expect(request?.url).toBe("https://api.business.githubcopilot.com/chat/completions");
    expect(request?.headers.get("authorization")).toBe("Bearer tid=session");
    expect(request?.headers.get("copilot-integration-id")).toBe("copilot-cli");
    expect(request?.headers.get("editor-version")).toBe("obsidian/1.8.0");
    expect(request?.headers.get("editor-plugin-version")).toBe("github-copilot-agent/0.1.0");
    expect(request?.headers.get("openai-intent")).toBe("conversation-agent");
    expect(request?.headers.get("x-github-api-version")).toBe("2026-01-09");
    expect(request?.headers.get("user-agent")).toBe("obsidian-copilot-agent/0.1.0");
    expect(request?.body).toMatchObject({ model: "gpt-4.1" });
  });

  test("maps provider failures", async () => {
    const provider = new GitHubCopilotProvider({
      model: "gpt-4.1",
      sessionTokenStore: tokenStore(),
      obsidianVersion: "1.8.0",
      pluginVersion: "0.1.0",
      fetcher: createJsonFetch({ error: { message: "denied" } }, 401),
    });

    await expect(
      provider.complete({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toMatchObject<Partial<ProviderError>>({ code: "github_copilot_error" });
  });

  test("ping makes a real one-token chat request", async () => {
    const fetcher = createJsonFetch(completionResponse("gpt-4.1"));
    const provider = new GitHubCopilotProvider({
      model: "gpt-4.1",
      sessionTokenStore: tokenStore(),
      obsidianVersion: "1.8.0",
      pluginVersion: "0.1.0",
      fetcher,
    });

    const result = await provider.ping();

    expect(result).toMatchObject({ ok: true, httpStatus: 200 });
    expect(fetcher.requests[0]?.url).toBe(
      "https://api.business.githubcopilot.com/chat/completions"
    );
    expect(fetcher.requests[0]?.headers.get("authorization")).toBe("Bearer tid=session");
    expect(fetcher.requests[0]?.body).toMatchObject({ model: "gpt-4.1", max_tokens: 1 });
  });

  test("streams Copilot chunks", async () => {
    const fetcher = createStreamingFetch(streamingResponse("gpt-4.1"));
    const provider = new GitHubCopilotProvider({
      model: "gpt-4.1",
      sessionTokenStore: tokenStore(),
      obsidianVersion: "1.8.0",
      pluginVersion: "0.1.0",
      fetcher,
    });

    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of provider.stream({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.delta.content).toBe("hel");
    expect(chunks[1]?.delta.tool_calls?.[0]?.function.name).toBe("lookup");
  });
});
