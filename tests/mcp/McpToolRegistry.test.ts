import { jest } from '@jest/globals';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpManager } from '../../src/mcp/McpManager';
import { McpToolRegistry } from '../../src/mcp/McpToolRegistry';
import type { McpClientHandle, McpServerConfig } from '../../src/mcp/types';

const sampleTool: Tool = {
  name: 'read_note',
  description: 'Read a note',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
};

const readOnlyTool: Tool = {
  ...sampleTool,
  annotations: { readOnlyHint: true },
};

function config(name: string): McpServerConfig {
  return { name, transport: { type: 'stdio', command: 'node' } };
}

describe('McpToolRegistry', () => {
  test('namespaces tools from connected clients', async (): Promise<void> => {
    const client = {
      listTools: jest.fn(async () => ({ tools: [sampleTool] })),
      setNotificationHandler: jest.fn(),
    };
    const handle = { name: 'vault', config: config('vault'), client } as unknown as McpClientHandle;
    const manager = { listClients: (): McpClientHandle[] => [handle] } as unknown as McpManager;
    const registry = new McpToolRegistry(manager);

    await expect(registry.refresh()).resolves.toEqual([
      { qualifiedName: 'vault__read_note', tool: sampleTool, serverName: 'vault', server: handle.config },
    ]);
    expect(registry.toOpenAITools()[0]?.function.name).toBe('vault__read_note');
  });

  test('refresh re-fetches tool lists', async (): Promise<void> => {
    const client = {
      listTools: jest.fn(async () => ({ tools: [sampleTool] })),
      setNotificationHandler: jest.fn(),
    };
    const handle = { name: 'vault', config: config('vault'), client } as unknown as McpClientHandle;
    const registry = new McpToolRegistry({ listClients: (): McpClientHandle[] => [handle] } as unknown as McpManager);

    await registry.refresh();
    await registry.refresh();

    expect(client.listTools).toHaveBeenCalledTimes(2);
    expect(client.setNotificationHandler).toHaveBeenCalled();
  });

  test('stores annotations by server and tool name', async (): Promise<void> => {
    const client = {
      listTools: jest.fn(async () => ({ tools: [readOnlyTool] })),
      setNotificationHandler: jest.fn(),
    };
    const handle = { name: 'vault', config: config('vault'), client } as unknown as McpClientHandle;
    const registry = new McpToolRegistry({ listClients: (): McpClientHandle[] => [handle] } as unknown as McpManager);
    await registry.refresh();
    expect(registry.getAnnotations('vault', 'read_note')).toEqual({ readOnlyHint: true });
  });
});
