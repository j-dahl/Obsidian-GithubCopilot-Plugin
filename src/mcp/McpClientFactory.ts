import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpClientHandle, McpServerConfig, McpTransport } from './types';

const CONNECT_TIMEOUT_MS = 30_000;
const CLIENT_INFO = { name: 'obsidian-github-copilot-agent', version: '0.1.0' };

export async function createClient(config: McpServerConfig): Promise<McpClientHandle> {
  validateTransportUrl(config.transport);
  if (config.transport.type === 'http') {
    return createHttpClient(config, config.transport);
  }

  const transport = createTransport(config.transport, config.env);
  return connectWithTransport(config, transport);
}

function validateTransportUrl(transport: McpTransport): void {
  if (transport.type === 'stdio') return;
  const parsed = new URL(transport.url);
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const allowLocal = 'allowInsecureLocal' in transport && transport.allowInsecureLocal === true;
  if (parsed.protocol !== 'https:' && !(allowLocal && local && parsed.protocol === 'http:')) {
    throw new Error('MCP HTTP/SSE URLs must use HTTPS unless localhost is explicitly allowed.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('MCP HTTP/SSE URLs must not include credentials.');
  }
}

async function createHttpClient(config: McpServerConfig, httpTransport: Extract<McpTransport, { type: 'http' }>): Promise<McpClientHandle> {
  let firstError: unknown;

  try {
    const transport = createTransport(httpTransport, config.env);
    return await connectWithTransport(config, transport);
  } catch (error: unknown) {
    firstError = error;
  }

  const fallbackTransport = createTransport(
    { type: 'sse', url: httpTransport.url, headers: httpTransport.headers },
    config.env,
  );

  try {
    return await connectWithTransport(config, fallbackTransport);
  } catch (fallbackError: unknown) {
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    console.debug('SSE fallback failed after Streamable HTTP failure', fallbackError);
    throw new Error(`Streamable HTTP connect failed (${message}); SSE fallback failed`);
  }
}

function createTransport(transport: McpTransport, envOverrides?: Record<string, string>): Transport {
  switch (transport.type) {
    case 'stdio': {
      const stdioTransport = new StdioClientTransport({
        command: transport.command,
        args: transport.args,
        cwd: transport.cwd,
        env: { ...getDefaultEnvironment(), ...envOverrides, ...transport.env },
        stderr: 'pipe',
      });
      stdioTransport.stderr?.on('data', (chunk: unknown): void => {
        console.debug(`[mcp:${transport.command}:stderr] ${String(chunk)}`);
      });
      return stdioTransport;
    }
    case 'http':
      return new StreamableHTTPClientTransport(new URL(transport.url), {
        requestInit: transport.headers ? { headers: transport.headers } : undefined,
      });
    case 'sse':
      // Legacy MCP servers can still require SSE; Streamable HTTP is attempted first.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      return new SSEClientTransport(new URL(transport.url), {
        requestInit: transport.headers ? { headers: transport.headers } : undefined,
      });
  }
}

async function connectWithTransport(config: McpServerConfig, transport: Transport): Promise<McpClientHandle> {
  const client = new Client(CLIENT_INFO);
  let connected = false;

  try {
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
    connected = true;
    return {
      name: config.name,
      config,
      client,
      transport,
      close: async (): Promise<void> => {
        try {
          await client.close();
        } finally {
          await transport.close();
        }
      },
    };
  } finally {
    if (!connected) {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    }
  }
}
