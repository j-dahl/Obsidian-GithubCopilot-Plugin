import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ChatCompletionTool, ChatCompletionToolMessageParam } from 'openai/resources/chat/completions';

export function mcpToolToOpenAI(tool: Tool, serverName: string): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: `${serverName}__${tool.name}`,
      description: tool.description ?? tool.annotations?.title ?? 'No description',
      parameters: tool.inputSchema,
    },
  };
}

export function callToolResultToOpenAIMessage(result: CallToolResult, toolCallId: string): ChatCompletionToolMessageParam {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: stringifyCallToolResult(result),
  };
}

function stringifyCallToolResult(result: CallToolResult): string {
  const blocks = result.content.map(formatContentBlock);
  if (result.structuredContent) {
    blocks.push(`Structured content: ${JSON.stringify(result.structuredContent)}`);
  }
  if (result.isError) {
    blocks.unshift('MCP tool returned an error.');
  }

  return blocks.join('\n\n');
}

type CallToolContentBlock = CallToolResult['content'][number];

function formatContentBlock(block: CallToolContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'image':
      return `[image:${block.mimeType}] ${block.data}`;
    case 'audio':
      return `[audio:${block.mimeType}] ${block.data}`;
    case 'resource':
      if ('text' in block.resource) {
        return `[resource:${block.resource.uri}] ${block.resource.text}`;
      }
      return `[resource:${block.resource.uri}] ${block.resource.blob}`;
    case 'resource_link':
      return `[resource_link:${block.uri}] ${block.title ?? block.name}${block.description ? ` - ${block.description}` : ''}`;
  }
}
