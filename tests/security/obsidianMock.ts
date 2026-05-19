export class TFile {
  path: string;

  constructor(path: string) {
    this.path = path;
  }
}

export class MenuItem {
  title = '';
  callback: (() => void) | undefined;

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  onClick(callback: () => void): this {
    this.callback = callback;
    return this;
  }
}

export class Menu {
  static latest: Menu | undefined;
  readonly items: MenuItem[] = [];

  addItem(callback: (item: MenuItem) => void): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }

  showAtMouseEvent(): void {
    Menu.latest = this;
  }
}

export interface EventRef {
  unload(): void;
}

export interface DataAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number } | null>;
  append(path: string, data: string): Promise<void>;
  read(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface Vault {
  adapter: DataAdapter;
  on(name: string, callback: (file: TFile) => void): EventRef;
}

export interface App {
  vault: Vault;
}

export interface WorkspaceLeaf {}

function appendText(this: HTMLElement, text: string): void {
  this.appendChild(document.createTextNode(text));
}

function empty(this: HTMLElement): void {
  this.replaceChildren();
}

function addClass(this: HTMLElement, className: string): void {
  this.classList.add(className);
}

function createEl(this: HTMLElement, tag: string, options?: { text?: string; cls?: string; attr?: Record<string, string>; type?: string; value?: string }): HTMLElement {
  const el = document.createElement(tag);
  if (options?.text) {
    el.textContent = options.text;
  }
  if (options?.cls) {
    el.className = options.cls;
  }
  if (options?.type && el instanceof HTMLInputElement) {
    el.type = options.type;
  }
  if (options?.value && el instanceof HTMLOptionElement) {
    el.value = options.value;
  }
  for (const [key, value] of Object.entries(options?.attr ?? {})) {
    el.setAttribute(key, value);
  }
  this.appendChild(el);
  return el;
}

function createDiv(this: HTMLElement, options?: { cls?: string; text?: string }): HTMLDivElement {
  return createEl.call(this, 'div', options) as HTMLDivElement;
}

function createSpan(this: HTMLElement, options?: { cls?: string; text?: string }): HTMLSpanElement {
  return createEl.call(this, 'span', options) as HTMLSpanElement;
}

if (typeof HTMLElement !== 'undefined') {
  HTMLElement.prototype.appendText = appendText;
  HTMLElement.prototype.empty = empty;
  HTMLElement.prototype.addClass = addClass;
  HTMLElement.prototype.createEl = createEl;
  HTMLElement.prototype.createDiv = createDiv;
  HTMLElement.prototype.createSpan = createSpan;
}

export class Modal {
  readonly app: App;
  readonly contentEl: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.contentEl = document.createElement('div');
  }

  open(): void {
    this.onOpen();
  }

  close(): void {
    this.onClose();
  }

  onOpen(): void {}
  onClose(): void {}
}

export class ItemView {
  readonly app: App;
  readonly containerEl: HTMLElement;
  readonly leaf: WorkspaceLeaf;

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.containerEl = document.createElement('div');
    this.app = { vault: { adapter: createEmptyAdapter(), on: () => ({ unload: () => undefined }) } };
  }

  registerEvent(): void {}
}

function createEmptyAdapter(): DataAdapter {
  return {
    exists: async () => false,
    mkdir: async () => undefined,
    stat: async () => null,
    append: async () => undefined,
    read: async () => '',
    remove: async () => undefined,
    rename: async () => undefined,
  };
}

export function setIcon(element: HTMLElement, icon: string): void {
  element.dataset.icon = icon;
}