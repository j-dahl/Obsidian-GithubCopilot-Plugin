export class Modal {
  readonly app: unknown;
  readonly contentEl: HTMLElement;
  constructor(app: unknown) {
    this.app = app;
    this.contentEl = document.createElement("div");
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

export interface App {
  vault?: unknown;
}

function createEl(
  this: HTMLElement,
  tag: string,
  options?: { text?: string; cls?: string; attr?: Record<string, string> }
): HTMLElement {
  const el = document.createElement(tag);
  if (options?.text) el.textContent = options.text;
  if (options?.cls) el.className = options.cls;
  for (const [key, value] of Object.entries(options?.attr ?? {})) el.setAttribute(key, value);
  this.appendChild(el);
  return el;
}
function createDiv(this: HTMLElement, options?: { text?: string; cls?: string }): HTMLDivElement {
  return createEl.call(this, "div", options) as HTMLDivElement;
}
function createSpan(this: HTMLElement, options?: { text?: string; cls?: string }): HTMLSpanElement {
  return createEl.call(this, "span", options) as HTMLSpanElement;
}
function empty(this: HTMLElement): void {
  this.replaceChildren();
}
function addClass(this: HTMLElement, className: string): void {
  this.classList.add(className);
}

HTMLElement.prototype.createEl = createEl;
HTMLElement.prototype.createDiv = createDiv;
HTMLElement.prototype.createSpan = createSpan;
HTMLElement.prototype.empty = empty;
HTMLElement.prototype.addClass = addClass;
