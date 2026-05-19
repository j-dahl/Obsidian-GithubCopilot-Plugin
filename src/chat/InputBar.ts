import { FuzzySuggestModal, type App, type Component, type TFile } from 'obsidian';

export interface InputBarEvents {
onSubmit: (text: string, attachedFiles: string[]) => void;
onStop: () => void;
}

class VaultFilePicker extends FuzzySuggestModal<TFile> {
private readonly onChoose: (path: string) => void;

constructor(app: App, onChoose: (path: string) => void) {
super(app);
this.onChoose = onChoose;
this.setPlaceholder('Attach a vault file');
}

getItems(): TFile[] {
return this.app.vault.getFiles();
}

getItemText(item: TFile): string {
return item.path;
}

onChooseItem(item: TFile): void {
this.onChoose(item.path);
}
}

export class InputBar {
private readonly container: HTMLElement;
private readonly component: Component;
private readonly app: App;
private readonly events: InputBarEvents;
private textarea: HTMLTextAreaElement | null = null;
private stopButton: HTMLButtonElement | null = null;
private attachments: string[] = [];
private attachmentList: HTMLElement | null = null;

constructor(container: HTMLElement, component: Component, app: App, events: InputBarEvents) {
this.container = container;
this.component = component;
this.app = app;
this.events = events;
}

render(isStreaming: boolean): void {
this.container.empty();
this.container.addClass('github-copilot-chat-input');
this.attachmentList = this.container.createDiv({ cls: 'github-copilot-chat-attachments' });
this.renderAttachments();
const row = this.container.createDiv({ cls: 'github-copilot-chat-input-row' });
const attachButton = row.createEl('button', { text: 'Attach file', cls: 'github-copilot-chat-attach' });
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.textarea = row.createEl('textarea', { cls: 'github-copilot-chat-textarea', attr: { rows: '1', placeholder: 'Ask Copilot…' } });
const submitButton = row.createEl('button', { text: 'Send', cls: 'github-copilot-chat-send' });
this.stopButton = row.createEl('button', { text: 'Stop', cls: 'github-copilot-chat-stop' });
this.stopButton.toggle(isStreaming);
this.component.registerDomEvent(attachButton, 'click', () => this.openFilePicker());
this.component.registerDomEvent(submitButton, 'click', () => this.submit());
this.component.registerDomEvent(this.stopButton, 'click', () => this.events.onStop());
this.component.registerDomEvent(this.textarea, 'input', () => this.resize());
this.component.registerDomEvent(this.textarea, 'keydown', (event: KeyboardEvent) => {
if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
event.preventDefault();
this.submit();
}
});
}

private openFilePicker(): void {
new VaultFilePicker(this.app, (path) => {
if (!this.attachments.includes(path)) {
this.attachments.push(path);
this.renderAttachments();
}
}).open();
}

private submit(): void {
const text = this.textarea?.value ?? '';
const attachedFiles = [...this.attachments];
this.attachments = [];
if (this.textarea) {
this.textarea.value = '';
this.resize();
}
this.renderAttachments();
this.events.onSubmit(text, attachedFiles);
}

private resize(): void {
if (!this.textarea) {
return;
}
// eslint-disable-next-line obsidianmd/no-static-styles-assignment
this.textarea.style.height = 'auto';
const lineHeight = 20;
this.textarea.style.height = `${Math.min(this.textarea.scrollHeight, lineHeight * 12)}px`;
}

private renderAttachments(): void {
if (!this.attachmentList) {
return;
}
this.attachmentList.empty();
for (const path of this.attachments) {
const chip = this.attachmentList.createSpan({ cls: 'github-copilot-chat-attachment', text: `<file path="${path}"/>` });
const remove = chip.createEl('button', { text: '×' });
this.component.registerDomEvent(remove, 'click', () => {
this.attachments = this.attachments.filter((item) => item !== path);
this.renderAttachments();
});
}
}
}
