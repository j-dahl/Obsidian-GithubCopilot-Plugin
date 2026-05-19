import type { McpClientHandle, McpServerConfig } from './types';
import { createClient } from './McpClientFactory';

type McpClientFactory = (config: McpServerConfig) => Promise<McpClientHandle>;

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;

export class McpManager {
  private readonly clients = new Map<string, McpClientHandle>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopping = false;

  constructor(private readonly clientFactory: McpClientFactory = createClient) {}

  async start(configs: McpServerConfig[]): Promise<void> {
    this.stopping = false;
    await Promise.allSettled(
      configs
        .filter((config: McpServerConfig): boolean => config.autoStart !== false)
        .map(async (config: McpServerConfig): Promise<void> => {
          await this.connectAndStore(config);
        }),
    ).then((results): void => {
      for (const result of results) {
        if (result.status === 'rejected') {
          console.warn('MCP server failed to start', result.reason);
        }
      }
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    await Promise.allSettled(
      Array.from(this.clients.values()).map(async (handle: McpClientHandle): Promise<void> => {
        try {
          await handle.close();
        } finally {
          this.clients.delete(handle.name);
        }
      }),
    );
  }

  getClient(name: string): McpClientHandle | undefined {
    return this.clients.get(name);
  }

  listClients(): McpClientHandle[] {
    return Array.from(this.clients.values());
  }

  private async connectAndStore(config: McpServerConfig): Promise<void> {
    const existing = this.clients.get(config.name);
    if (existing) {
      try {
        await existing.close();
      } finally {
        this.clients.delete(config.name);
      }
    }

    const handle = await this.clientFactory(config);
    handle.transport.onerror = (error: Error): void => {
      console.warn(`MCP transport error for ${config.name}`, error);
      this.scheduleReconnect(config);
    };
    handle.transport.onclose = (): void => {
      if (!this.stopping) {
        this.scheduleReconnect(config);
      }
    };
    this.clients.set(config.name, handle);
    this.reconnectAttempts.delete(config.name);
  }

  private scheduleReconnect(config: McpServerConfig): void {
    if (this.stopping || this.reconnectTimers.has(config.name)) {
      return;
    }

    const attempt = (this.reconnectAttempts.get(config.name) ?? 0) + 1;
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      console.warn(`MCP reconnect abandoned for ${config.name} after ${MAX_RECONNECT_ATTEMPTS} attempts`);
      return;
    }

    this.reconnectAttempts.set(config.name, attempt);
    const delay = Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
    const timer = setTimeout((): void => {
      this.reconnectTimers.delete(config.name);
      void this.reconnect(config);
    }, delay);
    this.reconnectTimers.set(config.name, timer);
  }

  private async reconnect(config: McpServerConfig): Promise<void> {
    const current = this.clients.get(config.name);
    if (current) {
      try {
        await current.close();
      } finally {
        this.clients.delete(config.name);
      }
    }

    try {
      await this.connectAndStore(config);
    } catch (error: unknown) {
      console.warn(`MCP reconnect failed for ${config.name}`, error);
      this.scheduleReconnect(config);
    }
  }
}
