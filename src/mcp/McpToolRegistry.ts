import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { McpManager } from './McpManager';
import type { McpClientHandle, NormalizedTool } from './types';
import { mcpToolToOpenAI } from './toolAdapter';

export class McpToolRegistry {
  private tools: NormalizedTool[] = [];
  private readonly annotations = new Map<string, NormalizedTool['tool']['annotations']>();

  constructor(private readonly manager: McpManager) {}

  async refresh(): Promise<NormalizedTool[]> {
    const handles = this.manager.listClients();
    const toolGroups = await Promise.all(
      handles.map(async (handle: McpClientHandle): Promise<NormalizedTool[]> => {
        const result = await handle.client.listTools();
        return result.tools.map((tool) => ({
          qualifiedName: `${handle.name}__${tool.name}`,
          tool,
          serverName: handle.name,
          server: handle.config,
        }));
      }),
    );

    this.tools = toolGroups.flat();
    this.annotations.clear();
    for (const entry of this.tools) {
      this.annotations.set(entry.qualifiedName, entry.tool.annotations);
      this.annotations.set(`${entry.serverName}/${entry.tool.name}`, entry.tool.annotations);
    }
    this.registerListChangedHandlers(handles);
    return this.list();
  }

  list(): NormalizedTool[] {
    return [...this.tools];
  }

  toOpenAITools(): ChatCompletionTool[] {
    return this.tools.map((tool: NormalizedTool): ChatCompletionTool => mcpToolToOpenAI(tool.tool, tool.serverName));
  }

  getAnnotations(serverName: string, toolName: string): NormalizedTool['tool']['annotations'] | undefined {
    return this.annotations.get(`${serverName}/${toolName}`) ?? this.annotations.get(`${serverName}__${toolName}`);
  }

  private registerListChangedHandlers(handles: McpClientHandle[]): void {
    for (const handle of handles) {
      handle.client.setNotificationHandler(ToolListChangedNotificationSchema, (): void => {
        void this.refresh();
      });
    }
  }
}
