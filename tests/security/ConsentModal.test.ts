jest.mock('obsidian', () => jest.requireActual('./obsidianMock'), { virtual: true });
import type { App } from 'obsidian';
import { Menu } from 'obsidian';
import { ConsentModal, type ConsentModalContext } from '../../src/security/ConsentModal';
import type { ConsentDecision } from '../../src/security/types';

const app = { vault: { adapter: {}, on: () => ({ unload: () => undefined }) } } as unknown as App;

function context(overrides: Partial<ConsentModalContext> = {}): ConsentModalContext {
  return {
    tool: { name: 'read_file', serverId: 'filesystem' },
    serverId: 'filesystem',
    conversationId: 'conversation-1',
    args: { path: 'note.md' },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    serverDescription: 'Filesystem tools',
    ...overrides,
  };
}

function buttons(modal: ConsentModal): HTMLButtonElement[] {
  return Array.from(modal.contentEl.querySelectorAll('button'));
}

describe('ConsentModal', () => {
  test('primary allow yields allow-once', () => {
    const decisions: ConsentDecision[] = [];
    const modal = new ConsentModal(app, context(), (decision) => decisions.push(decision));
    modal.open();
    buttons(modal)[0]?.click();
    expect(decisions).toEqual([{ type: 'allow-once' }]);
  });

  test('session checkbox turns allow into allow-session', () => {
    const decisions: ConsentDecision[] = [];
    const modal = new ConsentModal(app, context(), (decision) => decisions.push(decision));
    modal.open();
    const checkbox = modal.contentEl.querySelector('input');
    expect(checkbox).not.toBeNull();
    checkbox?.click();
    buttons(modal)[0]?.click();
    expect(decisions).toEqual([{ type: 'allow-session', conversationId: 'conversation-1' }]);
  });

  test('allow dropdown supports forever decision', () => {
    const decisions: ConsentDecision[] = [];
    const modal = new ConsentModal(app, context(), (decision) => decisions.push(decision));
    modal.open();
    buttons(modal)[1]?.dispatchEvent(new MouseEvent('click'));
    const alwaysAllow = Menu.latest?.items.find((item) => item.title === 'Always allow this tool');
    alwaysAllow?.callback?.();
    expect(decisions).toEqual([{ type: 'allow-forever', serverId: 'filesystem', toolName: 'read_file' }]);
  });

  test('primary deny yields deny-once', () => {
    const decisions: ConsentDecision[] = [];
    const modal = new ConsentModal(app, context(), (decision) => decisions.push(decision));
    modal.open();
    buttons(modal)[2]?.click();
    expect(decisions).toEqual([{ type: 'deny-once' }]);
  });

  test('deny dropdown supports never allow', () => {
    const decisions: ConsentDecision[] = [];
    const modal = new ConsentModal(app, context(), (decision) => decisions.push(decision));
    modal.open();
    buttons(modal)[3]?.dispatchEvent(new MouseEvent('click'));
    const neverAllow = Menu.latest?.items.find((item) => item.title === 'Never allow this tool');
    neverAllow?.callback?.();
    expect(decisions).toEqual([{ type: 'deny-forever', serverId: 'filesystem', toolName: 'read_file' }]);
  });

  test('escape/close rejects with deny-once', () => {
    const decisions: ConsentDecision[] = [];
    const modal = new ConsentModal(app, context(), (decision) => decisions.push(decision));
    modal.open();
    modal.close();
    expect(decisions).toEqual([{ type: 'deny-once' }]);
  });

  test('renders annotations, args, and server description', () => {
    const modal = new ConsentModal(app, context(), () => undefined);
    modal.open();
    expect(modal.contentEl.textContent).toContain('filesystem:read_file');
    expect(modal.contentEl.textContent).toContain('Read-only');
    expect(modal.contentEl.textContent).toContain('Filesystem tools');
    expect(modal.contentEl.textContent).toContain('note.md');
  });
});