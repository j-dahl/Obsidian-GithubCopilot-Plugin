import { jest } from '@jest/globals';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { McpClientHandle, McpServerConfig } from '../../src/mcp/types';

const connectFailures: unknown[] = [];
const connectOptions: RequestOptions[] = [];
const transportConstructors: string[] = [];
let createClient: (config: McpServerConfig) => Promise<McpClientHandle>;

class MockClient {
  constructor(_info: unknown) {}

  async connect(_transport: Transport, options?: RequestOptions): Promise<void> {
    connectOptions.push(options ?? {});
    const failure = connectFailures.shift();
    if (failure) {
      throw failure;
    }
  }

  async close(): Promise<void> {}
}

class BaseTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {}
  async send(_message: JSONRPCMessage): Promise<void> {}
  async close(): Promise<void> {}
}

class MockStdioClientTransport extends BaseTransport {
  readonly stderr = { on: jest.fn() };

  constructor(readonly params: unknown) {
    super();
    transportConstructors.push('stdio');
  }
}

class MockStreamableHTTPClientTransport extends BaseTransport {
  constructor(readonly url: URL, readonly opts?: unknown) {
    super();
    transportConstructors.push('http');
  }
}

class MockSSEClientTransport extends BaseTransport {
  constructor(readonly url: URL, readonly opts?: unknown) {
    super();
    transportConstructors.push('sse');
  }
}

describe('McpClientFactory', () => {
  beforeAll(async (): Promise<void> => {
    jest.doMock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }));
    jest.doMock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
      StdioClientTransport: MockStdioClientTransport,
      getDefaultEnvironment: (): Record<string, string> => ({ PATH: 'test-path' }),
    }));
    jest.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: MockStreamableHTTPClientTransport }));
    jest.doMock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: MockSSEClientTransport }));

    const module = await import('../../src/mcp/McpClientFactory');
    createClient = module.createClient;
  });

  beforeEach((): void => {
    connectFailures.length = 0;
    connectOptions.length = 0;
    transportConstructors.length = 0;
  });

  test('uses stdio transport with a 30s connect timeout', async (): Promise<void> => {
    const handle = await createClient({ name: 'fs', transport: { type: 'stdio', command: 'npx', args: ['server'], env: { A: 'B' } } });

    expect(handle.name).toBe('fs');
    expect(transportConstructors).toEqual(['stdio']);
    expect(connectOptions[0]?.timeout).toBe(30_000);
  });

  test('falls back from streamable HTTP to SSE on connect failure', async (): Promise<void> => {
    connectFailures.push(new Error('http failed'));

    const handle = await createClient({ name: 'remote', transport: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' } } });

    expect(handle.name).toBe('remote');
    expect(transportConstructors).toEqual(['http', 'sse']);
    expect(connectOptions).toHaveLength(2);
  });
});
