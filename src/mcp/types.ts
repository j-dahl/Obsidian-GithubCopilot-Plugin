import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export type McpTransport =
  | {
      type: 'stdio';
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
    }
  | {
      type: 'http';
      url: string;
      headers?: Record<string, string>;
    }
  | {
      type: 'sse';
      url: string;
      headers?: Record<string, string>;
    };

export type McpConfigSource =
  | 'vscode-workspace'
  | 'vscode-user'
  | 'vscode-insiders-user'
  | 'copilot-cli'
  | 'cursor-user'
  | 'cursor-project'
  | 'claude-desktop'
  | 'windsurf'
  | 'zed'
  | 'jetbrains-user';

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  autoStart?: boolean;
  env?: Record<string, string>;
}

export interface McpServerEntry {
  config: McpServerConfig;
  source: McpConfigSource;
}

export type DiscoveredServer = McpServerEntry;

export interface NormalizedTool {
  qualifiedName: string;
  tool: Tool;
  serverName: string;
  server: McpServerConfig;
}

export interface McpClientHandle {
  name: string;
  config: McpServerConfig;
  client: Client;
  transport: Transport;
  close(): Promise<void>;
}

export type McpCallToolResult = CallToolResult;
