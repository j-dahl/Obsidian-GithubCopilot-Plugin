import { App, WorkspaceLeaf } from "obsidian";
import { ChatView } from "../../src/chat/ChatView";
import type { ChatPluginContext, StreamChunk } from "../../src/chat/types";

function context(): ChatPluginContext {
  return {
    provider: {
      async *stream(): AsyncIterable<StreamChunk> {
        yield { content: "hello" };
      },
    },
    mcpRegistry: { toOpenAITools: () => [] },
    dispatcher: {
      async callTool() {
        return { content: [{ type: "text", text: "ok" }] };
      },
    },
    permissionGate: { evaluate: () => ({ action: "auto-allow" }) },
    auditLogger: { logToolCall: jest.fn() },
    trustedContent: { wrapForLlm: (_path, content) => content },
    settings: { selectedModel: "gpt-4o" },
    systemPrompt: "system",
    saveSettings: jest.fn(async () => undefined),
    getModelOptions: () => [
      { value: "gpt-4o", label: "gpt-4o" },
      { value: "gpt-4o-mini", label: "gpt-4o-mini" },
    ],
    signInViaDeviceFlow: jest.fn(async () => undefined),
  };
}

describe("ChatView", () => {
  test("renders switcher, model picker, message panel, and inline input row", async () => {
    const view = new ChatView(new WorkspaceLeaf(), context());
    view.app = new App();

    await view.onOpen();

    expect(view.contentEl.querySelector(".github-copilot-chat-switcher-panel")).not.toBeNull();
    expect(view.contentEl.querySelector(".github-copilot-chat-switcher")).not.toBeNull();
    expect(view.contentEl.querySelector(".github-copilot-chat-model-picker")).not.toBeNull();
    expect(view.contentEl.querySelector(".github-copilot-chat-message-panel")).not.toBeNull();
    expect(view.contentEl.querySelector(".github-copilot-chat-input-panel")).not.toBeNull();
    expect(view.contentEl.querySelector(".github-copilot-chat-input-row")).not.toBeNull();
  });

  test("clicking pencil opens rename UI and Enter saves", async () => {
    const ctx = context();
    const view = new ChatView(new WorkspaceLeaf(), ctx);
    view.app = new App();
    await view.onOpen();

    view.contentEl.querySelector<HTMLButtonElement>(".github-copilot-chat-rename")?.click();
    const input = view.contentEl.querySelector<HTMLInputElement>(
      ".github-copilot-chat-rename-input"
    );
    expect(input?.classList.contains("github-copilot-chat-hidden")).toBe(false);

    if (!input) throw new Error("rename input missing");
    input.value = "Renamed chat";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(
      view.contentEl.querySelector<HTMLOptionElement>(".github-copilot-chat-switcher option")
        ?.textContent
    ).toBe("Renamed chat");
    expect(ctx.settings.chatConversations?.[0]?.title).toBe("Renamed chat");
  });

  test("Esc cancels inline rename", async () => {
    const view = new ChatView(new WorkspaceLeaf(), context());
    view.app = new App();
    await view.onOpen();

    view.contentEl.querySelector<HTMLButtonElement>(".github-copilot-chat-rename")?.click();
    const input = view.contentEl.querySelector<HTMLInputElement>(
      ".github-copilot-chat-rename-input"
    );
    if (!input) throw new Error("rename input missing");
    input.value = "Should not save";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(
      view.contentEl.querySelector<HTMLOptionElement>(".github-copilot-chat-switcher option")
        ?.textContent
    ).not.toBe("Should not save");
  });
});
