import { App } from 'obsidian';
import { ToolMessage } from '../../src/chat/ToolMessage';
import type { ToolCall, ToolCallStatus } from '../../src/chat/types';
import { consentOpenCalls } from './securityStubs';

function baseTool(status: ToolCallStatus): ToolCall {
return {
id: 'tool-1',
name: 'delete_note',
serverName: 'obsidian-native',
arguments: { path: 'x.md' },
status,
annotations: { readOnlyHint: true, destructiveHint: true, openWorldHint: true },
result: status === 'success' ? 'ok' : undefined,
};
}

describe('ToolMessage', () => {
test.each([
['pending', 'Pending'],
['awaiting-consent', 'Awaiting consent'],
['running', 'Running'],
['success', 'Success'],
['error', 'Error'],
['aborted', 'Aborted'],
] satisfies Array<[ToolCallStatus, string]>)('renders %s badge', (status, label) => {
const host = document.createElement('div');
new ToolMessage(host, baseTool(status)).render();
expect(host.textContent).toContain(label);
});

test('renders annotation badges', () => {
const host = document.createElement('div');
new ToolMessage(host, baseTool('pending')).render();
expect(host.textContent).toContain('🔒 readOnly');
expect(host.textContent).toContain('⚠️ destructive');
expect(host.textContent).toContain('🌐 openWorld');
});

test('opens consent modal for awaiting-consent tool', () => {
consentOpenCalls.length = 0;
const host = document.createElement('div');
new ToolMessage(host, baseTool('awaiting-consent'), new App(), () => undefined).render();
expect(consentOpenCalls).toHaveLength(1);
});
});
