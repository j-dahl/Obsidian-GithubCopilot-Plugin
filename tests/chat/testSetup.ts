Element.prototype.empty = function empty(): void {
  this.textContent = "";
};
Element.prototype.addClass = function addClass(...classes: string[]): void {
  this.classList.add(...classes);
};
Element.prototype.removeClass = function removeClass(...classes: string[]): void {
  this.classList.remove(...classes);
};
Element.prototype.toggle = function toggle(show: boolean): void {
  (this as HTMLElement).style.display = show ? "" : "none";
};
Element.prototype.createDiv = function createDiv(options?: {
  cls?: string;
  text?: string;
}): HTMLDivElement {
  const element = document.createElement("div");
  if (options?.cls) element.className = options.cls;
  if (options?.text) element.textContent = options.text;
  this.appendChild(element);
  return element;
};
Element.prototype.createSpan = function createSpan(options?: {
  cls?: string;
  text?: string;
}): HTMLSpanElement {
  const element = document.createElement("span");
  if (options?.cls) element.className = options.cls;
  if (options?.text) element.textContent = options.text;
  this.appendChild(element);
  return element;
};
Element.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: { cls?: string; text?: string; value?: string; attr?: Record<string, string> }
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options?.cls) element.className = options.cls;
  if (options?.text) element.textContent = options.text;
  if (options?.value && "value" in element) element.value = options.value;
  if (options?.attr) {
    for (const [key, value] of Object.entries(options.attr)) element.setAttribute(key, value);
  }
  this.appendChild(element);
  return element;
};
