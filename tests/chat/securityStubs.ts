import type { ConsentDecision, ToolCall } from '../../src/chat/types';

export const consentOpenCalls: ToolCall[] = [];

export class ConsentModal {
private readonly toolCall: ToolCall;
private readonly onDecision: (decision: ConsentDecision) => void;
constructor(_app: unknown, toolCall: ToolCall, onDecision: (decision: ConsentDecision) => void) {
this.toolCall = toolCall;
this.onDecision = onDecision;
}
open(): void {
consentOpenCalls.push(this.toolCall);
this.onDecision('allow-once');
}
}

export class AuditView {}
export const AUDIT_VIEW_TYPE = 'github-copilot-agent-audit';
export const systemPrompt = 'system';
export function wrapForLlm(path: string, content: string): string {
return `<trusted path="${path}">${content}</trusted>`;
}
