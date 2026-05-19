import { ItemView, TFile, type WorkspaceLeaf } from 'obsidian';
import { AUDIT_LOG_PATH } from './AuditLogger';
import type { AuditDecision, AuditLogEntry } from './types';

export const AUDIT_VIEW_TYPE = 'github-copilot-agent-audit';
type TimeRange = 'all' | 'hour' | 'day';

const DECISION_COLORS: Record<AuditDecision, string> = {
  allowed: '#2e7d32',
  'auto-allowed': '#1565c0',
  'denied-once': '#c62828',
  'denied-forever': '#8e0000',
  error: '#ef6c00',
  aborted: '#616161',
};

export class AuditView extends ItemView {
  private entries: AuditLogEntry[] = [];
  private decisionFilter: AuditDecision | 'all' = 'all';
  private serverFilter = 'all';
  private timeRange: TimeRange = 'all';

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return AUDIT_VIEW_TYPE;
  }

  getDisplayText(): string {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Required view title from the security spec.
    return 'Agent Activity';
  }

  getIcon(): string {
    return 'list-checks';
  }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    await this.loadEntries();
    this.render();
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.path === AUDIT_LOG_PATH) {
          void this.loadEntries().then(() => this.render());
        }
      }),
    );
  }

  async onClose(): Promise<void> {
    this.containerEl.empty();
  }

  private async loadEntries(): Promise<void> {
    if (!(await this.app.vault.adapter.exists(AUDIT_LOG_PATH))) {
      this.entries = [];
      return;
    }
    const text = await this.app.vault.adapter.read(AUDIT_LOG_PATH);
    this.entries = text
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .slice(-500)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AuditLogEntry];
        } catch {
          return [];
        }
      })
      .reverse();
  }

  private render(): void {
    this.containerEl.empty();
    this.containerEl.addClass('github-copilot-agent-audit-view');
    const root = this.containerEl.createDiv({ cls: 'audit-view-root' });
    root.createEl('h2', { text: 'Agent activity' });
    this.renderFilters(root);
    const list = root.createDiv({ cls: 'audit-list' });
    list.setCssProps({ overflowY: 'auto', maxHeight: 'calc(100vh - 180px)' });
    for (const entry of this.filteredEntries()) {
      this.renderEntry(list, entry);
    }
  }

  private renderFilters(root: HTMLElement): void {
    const filters = root.createDiv({ cls: 'audit-filters' });
    this.renderSelect(filters, 'Decision', this.decisionOptions(), this.decisionFilter, (value) => {
      this.decisionFilter = value as AuditDecision | 'all';
      this.render();
    });
    this.renderSelect(filters, 'Server', this.serverOptions(), this.serverFilter, (value) => {
      this.serverFilter = value;
      this.render();
    });
    this.renderSelect(filters, 'Time', ['all', 'hour', 'day'], this.timeRange, (value) => {
      this.timeRange = value as TimeRange;
      this.render();
    });
  }

  private renderSelect(
    parent: HTMLElement,
    label: string,
    options: string[],
    selected: string,
    onChange: (value: string) => void,
  ): void {
    const wrapper = parent.createDiv({ cls: 'audit-filter-chip' });
    wrapper.createSpan({ text: `${label}: ` });
    const select = wrapper.createEl('select');
    for (const option of options) {
      const item = select.createEl('option', { text: option, value: option });
      item.selected = option === selected;
    }
    select.addEventListener('change', () => onChange(select.value));
  }

  private renderEntry(parent: HTMLElement, entry: AuditLogEntry): void {
    const details = parent.createEl('details', { cls: 'audit-entry' });
    const summary = details.createEl('summary');
    summary.createSpan({ text: `${entry.timestamp} · ${entry.serverId}:${entry.toolName} · ` });
    const badge = summary.createSpan({ text: entry.decision, cls: 'audit-decision-badge' });
    badge.setCssProps({
      backgroundColor: DECISION_COLORS[entry.decision],
      color: 'white',
      borderRadius: '999px',
      padding: '0 0.5em',
    });
    details.createEl('pre', {
      text: JSON.stringify({ args: entry.args, resultSummary: entry.resultSummary, status: entry.status }, null, 2),
    });
  }

  private filteredEntries(): AuditLogEntry[] {
    const cutoff = this.timeCutoff();
    return this.entries.filter((entry) => {
      const decisionMatches = this.decisionFilter === 'all' || entry.decision === this.decisionFilter;
      const serverMatches = this.serverFilter === 'all' || entry.serverId === this.serverFilter;
      const timeMatches = cutoff === null || Date.parse(entry.timestamp) >= cutoff;
      return decisionMatches && serverMatches && timeMatches;
    });
  }

  private timeCutoff(): number | null {
    if (this.timeRange === 'hour') {
      return Date.now() - 60 * 60 * 1000;
    }
    if (this.timeRange === 'day') {
      return Date.now() - 24 * 60 * 60 * 1000;
    }
    return null;
  }

  private decisionOptions(): string[] {
    return ['all', ...Object.keys(DECISION_COLORS)];
  }

  private serverOptions(): string[] {
    return ['all', ...Array.from(new Set(this.entries.map((entry) => entry.serverId))).sort()];
  }
}
