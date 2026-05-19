import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpManager } from './McpManager';

export class McpDispatchError extends Error {
  constructor(
    message: string,
    readonly qualifiedName: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'McpDispatchError';
  }
}

export class McpDispatcher {
  constructor(private readonly manager: McpManager) {}

  async dispatch(qualifiedName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    const parsed = parseQualifiedName(qualifiedName);
    if (!parsed) {
      throw new McpDispatchError(`Invalid MCP tool name: ${qualifiedName}`, qualifiedName);
    }

    const handle = this.manager.getClient(parsed.serverName);
    if (!handle) {
      throw new McpDispatchError(`No MCP client connected for server: ${parsed.serverName}`, qualifiedName);
    }

    try {
      const result = await handle.client.callTool({ name: parsed.toolName, arguments: args }, undefined, { signal });
      return result as CallToolResult;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new McpDispatchError(`MCP tool dispatch failed: ${message}`, qualifiedName, error);
    }
  }
}

function parseQualifiedName(qualifiedName: string): { serverName: string; toolName: string } | null {
  const delimiterIndex = qualifiedName.indexOf('__');
  if (delimiterIndex <= 0 || delimiterIndex >= qualifiedName.length - 2) {
    return null;
  }

  return {
    serverName: qualifiedName.slice(0, delimiterIndex),
    toolName: qualifiedName.slice(delimiterIndex + 2),
  };
}
