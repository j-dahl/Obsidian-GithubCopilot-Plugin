declare module 'security/ConsentModal' {
import type { App } from 'obsidian';
import type { ConsentDecision, ToolCall } from 'chat/types';
export class ConsentModal {
constructor(app: App, toolCall: ToolCall, onDecision: (decision: ConsentDecision) => void);
open(): void;
}
}

declare module 'security/AuditView' {
import type { App, ItemView, WorkspaceLeaf } from 'obsidian';
export const AUDIT_VIEW_TYPE: string;
export class AuditView extends ItemView {
constructor(leaf: WorkspaceLeaf, app?: App);
}
}

declare module 'security/systemPrompt' {
export const systemPrompt: string;
}

declare module 'security/trustedContent' {
export function wrapForLlm(path: string, content: string): string;
}
