declare const require: (moduleName: string) => unknown;

try {
  require("openai/shims/node");
} catch {
  // OpenAI 7 uses platform fetch directly and no longer publishes this shim.
}

const nodeUtil = require("node:util") as {
  TextDecoder: typeof TextDecoder;
  TextEncoder: typeof TextEncoder;
};

class TestHeaders {
  private readonly values = new Map<string, string>();

  constructor(init?: Record<string, string>) {
    for (const [key, value] of Object.entries(init ?? {})) {
      this.set(key, value);
    }
  }

  get(name: string): string | null {
    return this.values.get(name.toLowerCase()) ?? null;
  }

  set(name: string, value: string): void {
    this.values.set(name.toLowerCase(), value);
  }

  append(name: string, value: string): void {
    const existing = this.get(name);
    this.set(name, existing ? `${existing}, ${value}` : value);
  }

  has(name: string): boolean {
    return this.values.has(name.toLowerCase());
  }

  forEach(callback: (value: string, key: string) => void): void {
    this.values.forEach((value, key) => callback(value, key));
  }
}

class TestResponse {
  readonly headers: TestHeaders;
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  private readonly bodyText: string;

  constructor(body?: string | null, init?: { status?: number; statusText?: string; headers?: Record<string, string> }) {
    this.bodyText = body ?? "";
    this.status = init?.status ?? 200;
    this.statusText = init?.statusText ?? "";
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new TestHeaders(init?.headers);
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.bodyText) as unknown;
  }

  async text(): Promise<string> {
    return this.bodyText;
  }
}

if (typeof globalThis.Headers === "undefined") {
  globalThis.Headers = TestHeaders as unknown as typeof Headers;
}
if (typeof globalThis.Response === "undefined") {
  globalThis.Response = TestResponse as unknown as typeof Response;
}
if (typeof globalThis.fetch === "undefined") {
  globalThis.fetch = (() => Promise.reject(new Error("Unexpected test fetch call"))) as typeof fetch;
}
if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = nodeUtil.TextDecoder;
}
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = nodeUtil.TextEncoder;
}

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
