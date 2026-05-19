import { jest } from '@jest/globals';
import { McpDispatcher, McpDispatchError } from '../../src/mcp/McpDispatcher';
import type { McpManager } from '../../src/mcp/McpManager';
import type { McpClientHandle } from '../../src/mcp/types';

describe('McpDispatcher', () => {
  test('routes namespaced calls to the originating client', async (): Promise<void> => {
    const callTool = jest.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const manager = {
      getClient: (name: string): McpClientHandle | undefined =>
        name === 'vault' ? ({ client: { callTool } } as unknown as McpClientHandle) : undefined,
    } as unknown as McpManager;

    await expect(new McpDispatcher(manager).dispatch('vault__read_note', { path: 'Daily.md' })).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }],
    });
    expect(callTool).toHaveBeenCalledWith({ name: 'read_note', arguments: { path: 'Daily.md' } }, undefined, { signal: undefined });
  });

  test('maps protocol failures to McpDispatchError', async (): Promise<void> => {
    const manager = {
      getClient: (): McpClientHandle => ({ client: { callTool: async (): Promise<never> => { throw new Error('boom'); } } } as unknown as McpClientHandle),
    } as unknown as McpManager;

    await expect(new McpDispatcher(manager).dispatch('vault__explode', {})).rejects.toBeInstanceOf(McpDispatchError);
  });
});
