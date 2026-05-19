export class Component {
app: App;
constructor() {
this.app = new App();
}
registerDomEvent<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, callback: (event: HTMLElementEventMap[K]) => void): void {
el.addEventListener(type, callback as EventListener);
}
}

export class ItemView extends Component {
leaf: WorkspaceLeaf;
contentEl: HTMLElement;
constructor(leaf: WorkspaceLeaf) {
super();
this.leaf = leaf;
this.contentEl = document.createElement('div');
}
getViewType(): string { return 'mock'; }
getDisplayText(): string { return 'mock'; }
getIcon(): string { return 'mock'; }
}

export class App {
vault: Vault = new Vault();
workspace: Workspace = new Workspace();
metadataCache: MetadataCache = new MetadataCache();
}

export class Vault {
getFiles(): TFile[] { return []; }
getMarkdownFiles(): TFile[] { return []; }
getAbstractFileByPath(_path: string): TAbstractFile | null { return null; }
read(_file: TFile): Promise<string> { return Promise.resolve(''); }
cachedRead(_file: TFile): Promise<string> { return Promise.resolve(''); }
create(_path: string, _content: string): Promise<TFile> { return Promise.resolve({ path: _path, extension: 'md' } as TFile); }
append(_file: TFile, _content: string): Promise<void> { return Promise.resolve(); }
delete(_file: TAbstractFile): Promise<void> { return Promise.resolve(); }
}

export class Workspace {
activeEditor?: { editor?: { getSelection(): string } };
getActiveFile(): TFile | null { return null; }
getRightLeaf(_create: boolean): WorkspaceLeaf | null { return null; }
}

export class MetadataCache {
getFileCache(_file: TFile): { headings?: Array<{ heading: string }> } | null { return null; }
}

export class WorkspaceLeaf {
setViewState(_state: { type: string; active: boolean }): Promise<void> { return Promise.resolve(); }
}

export class FuzzySuggestModal<T> {
app: App;
constructor(app: App) { this.app = app; }
setPlaceholder(_placeholder: string): void {}
getItems(): T[] { return []; }
getItemText(_item: T): string { return ''; }
onChooseItem(_item: T): void {}
open(): void {}
}

export class Notice {
constructor(_message: string) {}
}

export class Plugin extends Component {
loadData(): Promise<unknown> { return Promise.resolve({}); }
saveData(_data: unknown): Promise<void> { return Promise.resolve(); }
registerView(_type: string, _creator: (leaf: WorkspaceLeaf) => ItemView): void {}
addRibbonIcon(_icon: string, _title: string, _callback: () => void): void {}
addCommand(_command: { id: string; name: string; callback: () => void }): void {}
}

export const MarkdownRenderer = {
renderMarkdown(markdown: string, el: HTMLElement): Promise<void> {
el.textContent = markdown;
return Promise.resolve();
},
};

export interface TAbstractFile { path: string }
export interface TFile extends TAbstractFile { extension: string }
export interface TFolder extends TAbstractFile { children: TAbstractFile[] }
