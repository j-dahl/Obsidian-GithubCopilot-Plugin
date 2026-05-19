/* eslint-disable obsidianmd/ui/sentence-case */
export class TFile {
  constructor(public path: string) {}
  extension = this.path.split(".").pop() ?? "md";
  basename = this.path;
  stat = { ctime: 0, mtime: 0, size: 0 };
}
export interface TAbstractFile {
  path: string;
}
export interface TFolder extends TAbstractFile {
  children: TAbstractFile[];
}
export interface EventRef {
  unload(): void;
}

function appendText(this: HTMLElement, text: string): void {
  this.appendChild(document.createTextNode(text));
}
function empty(this: HTMLElement): void {
  this.replaceChildren();
}
function addClass(this: HTMLElement, className: string): void {
  this.classList.add(className);
}
function setCssProps(this: HTMLElement, props: Record<string, string>): void {
  Object.assign(this.style, props);
}
function createEl(
  this: HTMLElement,
  tag: string,
  options?: {
    text?: string;
    cls?: string;
    attr?: Record<string, string>;
    type?: string;
    value?: string;
  }
): HTMLElement {
  const el = document.createElement(tag);
  if (options?.text) el.textContent = options.text;
  if (options?.cls) el.className = options.cls;
  if (options?.type && el instanceof HTMLInputElement) el.type = options.type;
  if (options?.value && el instanceof HTMLOptionElement) el.value = options.value;
  for (const [key, value] of Object.entries(options?.attr ?? {})) el.setAttribute(key, value);
  this.appendChild(el);
  return el;
}
function createDiv(this: HTMLElement, options?: { cls?: string; text?: string }): HTMLDivElement {
  return createEl.call(this, "div", options) as HTMLDivElement;
}
function createSpan(this: HTMLElement, options?: { cls?: string; text?: string }): HTMLSpanElement {
  return createEl.call(this, "span", options) as HTMLSpanElement;
}
if (typeof HTMLElement !== "undefined") {
  const proto = HTMLElement.prototype as unknown as {
    appendText: typeof appendText;
    empty: typeof empty;
    addClass: typeof addClass;
    setCssProps: typeof setCssProps;
    createEl: typeof createEl;
    createDiv: typeof createDiv;
    createSpan: typeof createSpan;
  };
  proto.appendText = appendText;
  proto.empty = empty;
  proto.addClass = addClass;
  proto.setCssProps = setCssProps;
  proto.createEl = createEl;
  proto.createDiv = createDiv;
  proto.createSpan = createSpan;
}

export class Component {
  app: App = new App();
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    callback: (event: HTMLElementEventMap[K]) => void
  ): void {
    el.addEventListener(type, callback as EventListener);
  }
  registerEvent(): void {}
}
export class WorkspaceLeaf {
  setViewState(_state: { type: string; active: boolean }): Promise<void> {
    return Promise.resolve();
  }
}
export class ItemView extends Component {
  contentEl = document.createElement("div");
  containerEl = this.contentEl;
  constructor(public leaf: WorkspaceLeaf) {
    super();
  }
  getViewType(): string {
    return "mock";
  }
  getDisplayText(): string {
    return "mock";
  }
  getIcon(): string {
    return "mock";
  }
}
export class Vault {
  adapter = {
    exists: async () => false,
    mkdir: async () => undefined,
    stat: async () => null,
    append: async () => undefined,
    read: async () => "",
    remove: async () => undefined,
    rename: async () => undefined,
  };
  getFiles(): TFile[] {
    return [];
  }
  getMarkdownFiles(): TFile[] {
    return [];
  }
  getAbstractFileByPath(_path: string): TAbstractFile | null {
    return null;
  }
  read(_file: TFile): Promise<string> {
    return Promise.resolve("");
  }
  cachedRead(_file: TFile): Promise<string> {
    return Promise.resolve("");
  }
  create(path: string, _content: string): Promise<TFile> {
    return Promise.resolve(new TFile(path));
  }
  append(_file: TFile, _content: string): Promise<void> {
    return Promise.resolve();
  }
  delete(_file: TAbstractFile): Promise<void> {
    return Promise.resolve();
  }
  on(_name: string, _callback: (file: TFile) => void): EventRef {
    return { unload: () => undefined };
  }
}
export class Workspace {
  activeEditor?: { editor?: { getSelection(): string } };
  getActiveFile(): TFile | null {
    return null;
  }
  getRightLeaf(_create: boolean): WorkspaceLeaf {
    return new WorkspaceLeaf();
  }
}
export class MetadataCache {
  getFileCache(_file: TFile): { headings?: Array<{ heading: string }> } | null {
    return null;
  }
}
export class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = new MetadataCache();
  getVersion(): string {
    return "1.5.0";
  }
}

export const settingCalls: Array<{ method: string; value?: unknown }> = [];
function record(method: string, value?: unknown): void {
  settingCalls.push({ method, value });
}
class ComponentMock {
  private buttonText = "";
  setValue(value: unknown): this {
    record("component.setValue", value);
    return this;
  }
  setPlaceholder(value: string): this {
    record("component.setPlaceholder", value);
    return this;
  }
  setTooltip(value: string): this {
    record("component.setTooltip", value);
    return this;
  }
  setButtonText(value: string): this {
    this.buttonText = value;
    record("component.setButtonText", value);
    return this;
  }
  setCta(): this {
    record("component.setCta");
    return this;
  }
  setType(value: string): this {
    record("component.setType", value);
    return this;
  }
  setHidden(value: boolean): this {
    record("component.setHidden", value);
    return this;
  }
  setDisabled(value: boolean): this {
    record("component.setDisabled", value);
    return this;
  }
  setLimits(min: number, max: number, step: number): this {
    record("component.setLimits", { min, max, step });
    return this;
  }
  setDynamicTooltip(): this {
    record("component.setDynamicTooltip");
    return this;
  }
  addOption(value: string, label: string): this {
    record("component.addOption", { value, label });
    return this;
  }
  onChange(): this {
    record("component.onChange");
    return this;
  }
  onClick(callback?: () => unknown): this {
    record("component.onClick", { buttonText: this.buttonText, callback });
    return this;
  }
}

export async function clickButton(buttonText: string): Promise<void> {
  const call = settingCalls.find(
    (entry) =>
      entry.method === "component.onClick" &&
      (entry.value as { buttonText?: string } | undefined)?.buttonText === buttonText
  );
  const callback = (call?.value as { callback?: () => unknown } | undefined)?.callback;
  if (!callback) throw new Error(`No button callback registered for ${buttonText}`);
  await callback();
}
export class Setting {
  constructor() {
    record("Setting");
  }
  setName(value: string): this {
    record("setName", value);
    return this;
  }
  setDesc(value: string): this {
    record("setDesc", value);
    return this;
  }
  setHeading(): this {
    record("setHeading");
    return this;
  }
  addDropdown(callback: (component: ComponentMock) => void): this {
    record("addDropdown");
    callback(new ComponentMock());
    return this;
  }
  addButton(callback: (component: ComponentMock) => void): this {
    record("addButton");
    callback(new ComponentMock());
    return this;
  }
  addText(callback: (component: ComponentMock) => void): this {
    record("addText");
    callback(new ComponentMock());
    return this;
  }
  addTextArea(callback: (component: ComponentMock) => void): this {
    record("addTextArea");
    callback(new ComponentMock());
    return this;
  }
  addToggle(callback: (component: ComponentMock) => void): this {
    record("addToggle");
    callback(new ComponentMock());
    return this;
  }
  addSlider(callback: (component: ComponentMock) => void): this {
    record("addSlider");
    callback(new ComponentMock());
    return this;
  }
}
export class Notice {
  constructor(message: string) {
    record("Notice", message);
  }
}
export class Modal {
  contentEl = document.createElement("div");
  constructor(public app: App) {}
  open(): void {
    this.onOpen();
    record("Modal.open");
  }
  close(): void {
    this.onClose();
    record("Modal.close");
  }
  onOpen(): void {}
  onClose(): void {}
}
export class FuzzySuggestModal<T> extends Modal {
  setPlaceholder(_placeholder: string): void {}
  getItems(): T[] {
    return [];
  }
  getItemText(_item: T): string {
    return "";
  }
  onChooseItem(_item: T): void {}
}
export class Plugin extends Component {
  manifest = { version: "0.1.0" };
  addCommand = jest.fn();
  addSettingTab = jest.fn();
  addRibbonIcon = jest.fn();
  registerView = jest.fn();
  loadData = jest.fn(async () => ({}));
  saveData = jest.fn(async () => undefined);
}
export class PluginSettingTab {
  containerEl = { empty: jest.fn(), isShown: () => false };
  constructor(
    public app: App,
    public plugin: Plugin
  ) {}
}
export class MenuItem {
  title = "";
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
export function setIcon(element: HTMLElement, icon: string): void {
  element.dataset.icon = icon;
}
export const MarkdownRenderer = {
  render: jest.fn(async (_app: App, markdown: string, el: HTMLElement) => {
    el.textContent = markdown;
  }),
  renderMarkdown(markdown: string, el: HTMLElement): Promise<void> {
    el.textContent = markdown;
    return Promise.resolve();
  },
};
