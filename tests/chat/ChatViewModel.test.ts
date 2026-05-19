import { ChatViewModel } from '../../src/chat/ChatViewModel';
import type { AuditLoggerLike, CallToolResult, ChatCompletionProvider, ChatPluginContext, ConsentDecision, McpRegistryLike, OpenAITool, PermissionDecision, PermissionGateLike, StreamChunk, ToolCall, ToolDispatcherLike } from '../../src/chat/types';

function toolCall(id: string, name = 'read_vault_file'): ToolCall {
return { id, name, serverName: 'test-server', arguments: { path: 'a.md' }, status: 'pending', annotations: { readOnlyHint: true } };
}

class ScriptedProvider implements ChatCompletionProvider {
calls = 0;
constructor(private readonly scripts: StreamChunk[][]) {}
async *stream(request: { signal: AbortSignal }): AsyncIterable<StreamChunk> {
const script = this.scripts[Math.min(this.calls, this.scripts.length - 1)] ?? [];
this.calls += 1;
for (const chunk of script) {
if (request.signal.aborted) {
return;
}
yield chunk;
}
}
}

class Gate implements PermissionGateLike {
constructor(private readonly decision: PermissionDecision) {}
evaluate(): PermissionDecision {
return this.decision;
}
}

class Dispatcher implements ToolDispatcherLike {
calls: ToolCall[] = [];
constructor(private readonly result: CallToolResult | Error = { content: [{ type: 'text', text: 'tool ok' }] }) {}
async callTool(serverName: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
this.calls.push({ id: 'called', serverName, name, arguments: args, status: 'success' });
if (this.result instanceof Error) {
throw this.result;
}
return this.result;
}
}

class Audit implements AuditLoggerLike {
entries: string[] = [];
logToolCall(entry: { decision: string }): void {
this.entries.push(entry.decision);
}
}

function context(provider: ChatCompletionProvider, gate: PermissionGateLike, dispatcher: ToolDispatcherLike, audit = new Audit()): ChatPluginContext {
const registry: McpRegistryLike = { toOpenAITools: (): OpenAITool[] => [] };
return {
provider,
mcpRegistry: registry,
dispatcher,
permissionGate: gate,
auditLogger: audit,
trustedContent: { wrapForLlm: (path, content) => `<trusted path="${path}">${content}</trusted>` },
settings: {},
systemPrompt: 'system',
};
}

describe('ChatViewModel', () => {
test('single text turn without tools', async () => {
const provider = new ScriptedProvider([[{ content: 'hello' }]]);
const vm = new ChatViewModel(context(provider, new Gate({ action: 'auto-allow' }), new Dispatcher()));
await vm.sendUserMessage('Hi', []);
expect(vm.currentConversation.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
expect(vm.currentConversation.messages[1]?.content).toBe('hello');
expect(vm.runState).toBe('idle');
});

test('auto-allowed tool call dispatches and recurses', async () => {
const provider = new ScriptedProvider([[{ toolCalls: [toolCall('t1')] }], [{ content: 'done' }]]);
const dispatcher = new Dispatcher();
const audit = new Audit();
const vm = new ChatViewModel(context(provider, new Gate({ action: 'auto-allow' }), dispatcher, audit));
await vm.sendUserMessage('Use tool', []);
expect(dispatcher.calls).toHaveLength(1);
expect(audit.entries).toEqual(['auto-allow']);
expect(vm.currentConversation.messages.some((message) => message.content === 'tool ok')).toBe(true);
});

test('consent allow-once dispatches requested tool', async () => {
const provider = new ScriptedProvider([[{ toolCalls: [toolCall('t2')] }], [{ content: 'after consent' }]]);
const dispatcher = new Dispatcher();
const decisions: ConsentDecision[] = [];
const vm = new ChatViewModel(context(provider, new Gate({ action: 'ask', reason: 'policy' }), dispatcher), {
onConsent: () => {
decisions.push('allow-once');
return Promise.resolve('allow-once');
},
});
await vm.sendUserMessage('Use tool', []);
expect(decisions).toEqual(['allow-once']);
expect(dispatcher.calls).toHaveLength(1);
});

test('denied policy creates synthetic tool message', async () => {
const provider = new ScriptedProvider([[{ toolCalls: [toolCall('t3')] }], [{ content: 'continued' }]]);
const dispatcher = new Dispatcher();
const vm = new ChatViewModel(context(provider, new Gate({ action: 'deny', reason: 'blocked' }), dispatcher));
await vm.sendUserMessage('Use tool', []);
expect(dispatcher.calls).toHaveLength(0);
expect(vm.currentConversation.messages.some((message) => message.content.includes('Denied by policy: blocked'))).toBe(true);
});

test('tool server error is rendered', async () => {
const provider = new ScriptedProvider([[{ toolCalls: [toolCall('t4')] }], [{ content: 'continued' }]]);
const vm = new ChatViewModel(context(provider, new Gate({ action: 'auto-allow' }), new Dispatcher(new Error('server down'))));
await vm.sendUserMessage('Use tool', []);
expect(vm.currentConversation.messages.some((message) => message.content === 'server down')).toBe(true);
});

test('recursion cap stops infinite tool loops', async () => {
const provider = new ScriptedProvider(Array.from({ length: 11 }, (_unused, index) => [{ toolCalls: [toolCall(`t${index}`)] }]));
const vm = new ChatViewModel(context(provider, new Gate({ action: 'auto-allow' }), new Dispatcher()));
await vm.sendUserMessage('Loop', []);
expect(vm.currentConversation.messages.some((message) => message.content.includes('Recursion cap hit'))).toBe(true);
expect(vm.runState).toBe('error');
});

test('stop-generation aborts the stream', async () => {
class HangingProvider implements ChatCompletionProvider {
async *stream(request: { signal: AbortSignal }): AsyncIterable<StreamChunk> {
yield { content: 'partial' };
await new Promise<void>((resolve) => request.signal.addEventListener('abort', () => resolve(), { once: true }));
}
}
const vm = new ChatViewModel(context(new HangingProvider(), new Gate({ action: 'auto-allow' }), new Dispatcher()));
const pending = vm.sendUserMessage('Stop', []);
for (let attempt = 0; attempt < 10 && vm.currentConversation.messages[1]?.content !== 'partial'; attempt += 1) {
await new Promise((resolve) => setTimeout(resolve, 0));
}
vm.stopGeneration();
await pending;
expect(vm.runState).toBe('idle');
expect(vm.currentConversation.messages[1]?.content).toBe('partial');
});
});
