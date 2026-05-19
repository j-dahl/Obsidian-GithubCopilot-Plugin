import { Menu, Modal, setIcon, type App } from 'obsidian';
import type { ConsentDecision, NormalizedTool, ToolAnnotations } from './types';

export interface ConsentModalContext {
  tool: NormalizedTool;
  serverId: string;
  conversationId: string;
  args: Record<string, unknown>;
  annotations?: ToolAnnotations;
  serverDescription?: string;
}

export class ConsentModal extends Modal {
  private readonly ctx: ConsentModalContext;
  private readonly onDecide: (decision: ConsentDecision) => void;
  private dontAskForSession = false;
  private decided = false;

  constructor(app: App, ctx: ConsentModalContext, onDecide: (d: ConsentDecision) => void) {
    super(app);
    this.ctx = ctx;
    this.onDecide = onDecide;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('github-copilot-agent-consent');
    contentEl.createEl('h2', { text: 'Approve tool call?' });
    contentEl.createEl('p', { text: `${this.ctx.serverId}:${this.ctx.tool.name}` });
    this.renderBadges(contentEl);
    if (this.ctx.serverDescription) {
      contentEl.createEl('p', { text: this.ctx.serverDescription });
    }
    const details = contentEl.createEl('details');
    details.createEl('summary', { text: 'Arguments' });
    details.createEl('pre', { text: JSON.stringify(this.ctx.args, null, 2) });

    const label = contentEl.createEl('label');
    const checkbox = label.createEl('input', { type: 'checkbox' });
    const updateSessionChoice = () => {
      this.dontAskForSession = checkbox.checked;
    };
    checkbox.addEventListener('change', updateSessionChoice);
    checkbox.addEventListener('click', updateSessionChoice);
    label.appendText(" Don't ask again until end of session");

    const actions = contentEl.createDiv({ cls: 'modal-button-container' });
    this.renderSplitButton(actions, 'Allow', ['Allow once', 'Allow for this conversation', 'Always allow this tool'], (labelText) => {
      if (this.dontAskForSession || labelText === 'Allow for this conversation') {
        this.decide({ type: 'allow-session', conversationId: this.ctx.conversationId });
      } else if (labelText === 'Always allow this tool') {
        this.decide({ type: 'allow-forever', serverId: this.ctx.serverId, toolName: this.ctx.tool.name });
      } else {
        this.decide({ type: 'allow-once' });
      }
    });
    contentEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.decide({ type: 'deny-once' });
      }
    });

    this.renderSplitButton(actions, 'Deny', ['Deny once', 'Never allow this tool'], (labelText) => {
      if (labelText === 'Never allow this tool') {
        this.decide({ type: 'deny-forever', serverId: this.ctx.serverId, toolName: this.ctx.tool.name });
      } else {
        this.decide({ type: 'deny-once' });
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) {
      this.onDecide({ type: 'deny-once' });
    }
  }

  private renderBadges(parent: HTMLElement): void {
    const badges = parent.createDiv({ cls: 'annotation-badges' });
    const annotations = this.ctx.annotations;
    if (annotations?.readOnlyHint) {
      this.createBadge(badges, 'lock', 'Read-only');
    }
    if (annotations?.destructiveHint ?? true) {
      this.createBadge(badges, 'alert-triangle', 'Destructive');
    }
    if (annotations?.openWorldHint ?? true) {
      this.createBadge(badges, 'globe', 'Network');
    }
  }

  private createBadge(parent: HTMLElement, icon: string, label: string): void {
    const badge = parent.createSpan({ cls: 'annotation-badge' });
    setIcon(badge, icon);
    badge.appendText(` ${label}`);
  }

  private renderSplitButton(
    parent: HTMLElement,
    label: string,
    items: string[],
    onSelect: (labelText: string) => void,
  ): void {
    const group = parent.createDiv({ cls: 'split-button' });
    const primary = group.createEl('button', { text: label });
    primary.addEventListener('click', () => onSelect(items[0] ?? label));
    const dropdown = group.createEl('button', { text: '▾', attr: { 'aria-label': `${label} options` } });
    dropdown.addEventListener('click', (event) => {
      const menu = new Menu();
      for (const itemLabel of items) {
        menu.addItem((item) => item.setTitle(itemLabel).onClick(() => onSelect(itemLabel)));
      }
      menu.showAtMouseEvent(event);
    });
  }

  private decide(decision: ConsentDecision): void {
    this.decided = true;
    this.onDecide(decision);
    this.close();
  }
}