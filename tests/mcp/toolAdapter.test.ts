import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { callToolResultToOpenAIMessage, mcpToolToOpenAI } from "../../src/mcp/toolAdapter";

describe("toolAdapter", () => {
  test("preserves MCP schemas that already declare properties", (): void => {
    const schema = {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    };
    const tool: Tool = { name: "search", description: "Search notes", inputSchema: schema };

    expect(mcpToolToOpenAI(tool, "vault")).toEqual({
      type: "function",
      function: {
        name: "vault__search",
        description: "Search notes",
        parameters: schema,
      },
    });
  });

  test("adds empty properties to object schemas that omit them", (): void => {
    const tool: Tool = { name: "active", inputSchema: { type: "object" } };

    expect(mcpToolToOpenAI(tool, "vault").function.parameters).toEqual({
      type: "object",
      properties: {},
    });
  });

  test("uses annotation title and no-description fallbacks", (): void => {
    const titled: Tool = {
      name: "a",
      annotations: { title: "Title" },
      inputSchema: { type: "object" },
    };
    const untitled: Tool = { name: "b", inputSchema: { type: "object" } };

    expect(mcpToolToOpenAI(titled, "s").function.description).toBe("Title");
    expect(mcpToolToOpenAI(untitled, "s").function.description).toBe("No description");
  });

  test("converts multi-content tool results to a tool message string", (): void => {
    const result: CallToolResult = {
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "base64-image", mimeType: "image/png" },
        { type: "audio", data: "base64-audio", mimeType: "audio/wav" },
        { type: "resource", resource: { uri: "file:///note.md", text: "note text" } },
        { type: "resource_link", uri: "file:///other.md", name: "other.md", title: "Other" },
      ],
    };

    const message = callToolResultToOpenAIMessage(result, "call-1");

    expect(message.role).toBe("tool");
    expect(message.tool_call_id).toBe("call-1");
    expect(message.content).toContain("hello");
    expect(message.content).toContain("[image:image/png] base64-image");
    expect(message.content).toContain("[resource:file:///note.md] note text");
    expect(message.content).toContain("[resource_link:file:///other.md] Other");
  });
});
