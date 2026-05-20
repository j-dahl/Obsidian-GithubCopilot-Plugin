export interface SettingCall {
  method: string;
  value?: unknown;
}

export const settingCalls: SettingCall[] = [];

function record(method: string, value?: unknown): void {
  settingCalls.push({ method, value });
}

class ComponentMock {
  inputEl = document.createElement("input");
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
  onClick(): this {
    record("component.onClick");
    return this;
  }
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
  contentEl = { empty: jest.fn() };
  constructor(public app: App) {}
  open(): void {
    record("Modal.open");
  }
  close(): void {
    record("Modal.close");
  }
}

export class Plugin {
  manifest = { version: "0.1.0" };
  app: App = new App();
  addCommand = jest.fn();
  addSettingTab = jest.fn();
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

export class App {
  workspace = {
    getRightLeaf: jest.fn(() => ({ setViewState: jest.fn(async () => undefined) })),
  };
  getVersion(): string {
    return "1.5.0";
  }
}
