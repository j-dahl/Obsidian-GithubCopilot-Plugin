/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
import { App } from "obsidian";
import { SettingsTab, DEFAULT_SETTINGS, type PluginSettings } from "../../src/settings";
import { settingCalls } from "../obsidianMock";
import { AuthError, clearGitHubTokenCache, getGitHubToken } from "../../src/auth";
import { discoverAllConfigs } from "../../src/mcp/McpDiscovery";
import { getModels } from "../../src/providers/catalog";
import { createProvider } from "../../src/providers/factory";
import { ProviderError } from "../../src/providers/types";

const mockExecFile = jest.fn();

jest.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));
jest.mock("../../src/auth", () => {
  const actual = jest.requireActual("../../src/auth") as Record<string, unknown>;
  return {
    ...actual,
    clearGitHubTokenCache: jest.fn(),
    getGitHubToken: jest.fn(async () => null),
    runDeviceFlow: jest.fn(),
  };
});
jest.mock("../../src/mcp/McpDiscovery", () => ({ discoverAllConfigs: jest.fn(async () => []) }));
jest.mock("../../src/providers/catalog", () => ({ getModels: jest.fn(async () => []) }));
jest.mock("../../src/providers/factory", () => ({ createProvider: jest.fn() }));

const mockGetGitHubToken = getGitHubToken as jest.MockedFunction<typeof getGitHubToken>;
const mockClearGitHubTokenCache = clearGitHubTokenCache as jest.MockedFunction<
  typeof clearGitHubTokenCache
>;
const mockDiscoverAllConfigs = discoverAllConfigs as jest.MockedFunction<typeof discoverAllConfigs>;
const mockGetModels = getModels as jest.MockedFunction<typeof getModels>;
const mockCreateProvider = createProvider as jest.MockedFunction<typeof createProvider>;

const createPlugin = () => ({
  app: new App(),
  manifest: { version: "0.1.0" },
  settings: {
    ...DEFAULT_SETTINGS,
    mcpServers: [
      {
        id: "filesystem",
        name: "Filesystem",
        enabled: true,
        autoApproveReadOnly: false,
        autoApproveAll: false,
        disabledTools: ["delete_file"],
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        source: "test",
      },
    ],
  } satisfies PluginSettings,
  saveSettings: jest.fn(async () => undefined),
  provider: { ping: jest.fn(async () => true) },
  getProviderFactoryDeps: jest.fn(() => ({
    obsidianVersion: "1.5.0",
    pluginVersion: "0.1.0",
    sessionTokenStore: { clear: jest.fn(), getValidSessionToken: jest.fn() },
  })),
  addCommand: jest.fn(),
  addSettingTab: jest.fn(),
  loadData: jest.fn(),
  saveData: jest.fn(),
});

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("SettingsTab", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  beforeEach(() => {
    settingCalls.length = 0;
    jest.clearAllMocks();
    mockGetGitHubToken.mockResolvedValue(null);
    mockDiscoverAllConfigs.mockResolvedValue([]);
    mockGetModels.mockResolvedValue([]);
    mockCreateProvider.mockReturnValue({
      id: "github-models",
      displayName: "GitHub Models",
      supportsTools: true,
      complete: jest.fn(),
      stream: jest.fn(),
      ping: jest.fn(async () => ({ ok: true, latencyMs: 42, httpStatus: 200 })),
    });
    mockExecFile.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, cb: (error: Error | null) => void) =>
        cb(null)
    );
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.clearAllTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it("renders all settings sections with the Setting builder API", async () => {
    const plugin = createPlugin();
    const tab = new SettingsTab(plugin.app, plugin);

    tab.display();
    jest.runOnlyPendingTimers();
    await flushPromises();

    expect(mockGetGitHubToken).toHaveBeenCalledTimes(2);
    expect(mockGetGitHubToken).toHaveBeenCalledWith({ purpose: "models" });
    expect(mockGetGitHubToken).toHaveBeenCalledWith({ purpose: "copilot" });
    expect(mockDiscoverAllConfigs).toHaveBeenCalledTimes(1);
    expect(mockGetModels).toHaveBeenCalledTimes(1);
    expect(settingCalls.length).toBeGreaterThan(0);
    expect(
      settingCalls.filter((call) => call.method === "setName").map((call) => call.value)
    ).toEqual(expect.arrayContaining(["Backend", "Model", "MCP servers", "Diagnostics"]));
    expect(tab.containerEl.querySelector(".github-copilot-settings-section-error")).toBeNull();
    expect(settingCalls.some((call) => call.method === "component.setType")).toBe(false);
  });

  it("isolates section render failures and continues rendering later sections", () => {
    const plugin = createPlugin();
    const tab = new SettingsTab(plugin.app, plugin);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (tab as unknown as { renderModelSection: () => void }).renderModelSection = () => {
      throw new Error("model boom");
    };

    tab.display();

    expect(
      tab.containerEl.querySelector(".github-copilot-settings-section-error")?.textContent
    ).toContain("Model failed to render");
    expect(
      settingCalls.filter((call) => call.method === "setName").map((call) => call.value)
    ).toEqual(expect.arrayContaining(["Backend", "Security preset", "Diagnostics"]));
    errorSpy.mockRestore();
  });

  it("renders test connection status immediately in a dedicated element", async () => {
    mockGetGitHubToken.mockResolvedValue({
      token: "gho_test",
      source: "gh:auth-token",
      tokenType: "gho",
    });
    let resolvePing:
      | ((value: { ok: true; latencyMs: number; httpStatus: number }) => void)
      | undefined;
    mockCreateProvider.mockReturnValue({
      id: "github-models",
      displayName: "GitHub Models",
      supportsTools: true,
      complete: jest.fn(),
      stream: jest.fn(),
      ping: jest.fn(
        () =>
          new Promise((resolve) => {
            resolvePing = resolve;
          })
      ),
    });
    const plugin = createPlugin();
    plugin.settings.githubToken = "gho_test";
    const tab = new SettingsTab(plugin.app, plugin);
    tab.display();

    const click = (tab as unknown as { testConnection(): Promise<void> }).testConnection();
    for (let i = 0; i < 5 && !resolvePing; i += 1) await flushPromises();

    const status = tab.containerEl.querySelector(".github-copilot-test-connection-status");
    expect(status?.textContent).toBe("Testing…");
    expect(resolvePing).toBeDefined();
    resolvePing?.({ ok: true, latencyMs: 17, httpStatus: 200 });
    await click;
    expect(status?.textContent).toContain("200 in 17ms");
  });

  it("renders every live catalog model with publisher grouping and badges", async () => {
    mockGetModels.mockResolvedValue([
      {
        id: "openai/gpt-4.1",
        name: "gpt-4.1",
        publisher: "OpenAI",
        supportsTools: true,
        supportsStreaming: true,
        inputModalities: ["text"],
      },
      {
        id: "meta/llama-4",
        name: "llama-4",
        publisher: "Meta",
        supportsTools: false,
        supportsStreaming: true,
        inputModalities: ["text"],
      },
    ]);
    const plugin = createPlugin();
    const tab = new SettingsTab(plugin.app, plugin);

    await (tab as unknown as { refreshModels(showNotice: boolean): Promise<void> }).refreshModels(
      false
    );
    tab.display();

    const options = settingCalls
      .filter((call) => call.method === "component.addOption")
      .map((call) => call.value);
    expect(options).toEqual(
      expect.arrayContaining([
        { value: "openai/gpt-4.1", label: "OpenAI / gpt-4.1 🔧 🌊" },
        { value: "meta/llama-4", label: "Meta / llama-4 🌊" },
      ])
    );
  });

  it.each([
    [401, "models:read"],
    [403, "opt-in to the free tier"],
    [404, "publisher/name"],
    [429, "rate-limited"],
    [503, "server error"],
  ])("shows actionable guidance for HTTP %s", async (status, hint) => {
    mockGetGitHubToken.mockResolvedValue({
      token: "gho_test",
      source: "gh:auth-token",
      tokenType: "gho",
    });
    mockCreateProvider.mockReturnValue({
      id: "github-models",
      displayName: "GitHub Models",
      supportsTools: true,
      complete: jest.fn(),
      stream: jest.fn(),
      ping: jest.fn(async () => {
        throw new ProviderError("github_models_error", "request failed", undefined, status);
      }),
    });
    const plugin = createPlugin();
    const tab = new SettingsTab(plugin.app, plugin);

    await (tab as unknown as { testConnection(): Promise<void> }).testConnection();

    const report = (
      tab as unknown as {
        connectionFailureReport: { httpStatus: number | null; remediation: string } | null;
      }
    ).connectionFailureReport;
    expect(report).not.toBeNull();
    expect(report?.httpStatus).toBe(status);
    expect(report?.remediation).toContain(hint);
  });

  it("renders successful test latency", async () => {
    mockGetGitHubToken.mockResolvedValue({
      token: "gho_test",
      source: "gh:auth-token",
      tokenType: "gho",
    });
    const plugin = createPlugin();
    const tab = new SettingsTab(plugin.app, plugin);

    await (tab as unknown as { testConnection(): Promise<void> }).testConnection();

    expect(
      settingCalls.some(
        (call) => call.method === "Notice" && String(call.value).includes("200 in 42ms")
      )
    ).toBe(true);
  });

  it("renders Copilot scope guidance and recovery buttons", async () => {
    mockCreateProvider.mockReturnValue({
      id: "github-copilot",
      displayName: "GitHub Copilot",
      supportsTools: true,
      complete: jest.fn(),
      stream: jest.fn(),
      ping: jest.fn(async () => {
        throw new AuthError("copilot_scope_missing", "missing scope", {
          httpStatus: 404,
          tokenSource: "gh:auth-token",
        });
      }),
    });
    const plugin = createPlugin();
    plugin.settings.backend = "github-copilot";
    plugin.settings.selectedModel = "gpt-4o";
    plugin.settings.githubToken = "gho_test";
    const tab = new SettingsTab(plugin.app, plugin);

    await (tab as unknown as { testConnection(): Promise<void> }).testConnection();
    tab.display();

    const report = (
      tab as unknown as {
        connectionFailureReport: {
          httpStatus: number | null;
          isScopeMissing: boolean;
          remediation: string;
        } | null;
      }
    ).connectionFailureReport;
    expect(report?.isScopeMissing).toBe(true);
    expect(report?.httpStatus).toBe(404);
    expect(report?.remediation).toContain("copilot");

    const block = tab.containerEl.querySelector(".github-copilot-error-details");
    expect(block).not.toBeNull();
    const buttonTexts = Array.from(block?.querySelectorAll(".error-actions button") ?? []).map(
      (el) => el.textContent
    );
    expect(buttonTexts).toEqual(
      expect.arrayContaining(["Refresh gh scope", "Sign in via device flow"])
    );
  });

  it("refreshes gh scope, clears caches, and reruns the connection test", async () => {
    const plugin = createPlugin();
    const sessionTokenStore = plugin.getProviderFactoryDeps().sessionTokenStore;
    plugin.getProviderFactoryDeps.mockReturnValue({
      obsidianVersion: "1.5.0",
      pluginVersion: "0.1.0",
      sessionTokenStore,
    });
    plugin.settings.backend = "github-copilot";
    plugin.settings.selectedModel = "gpt-4o";
    plugin.settings.githubToken = "gho_test";
    const ping = jest
      .fn()
      .mockRejectedValueOnce(
        new AuthError("copilot_scope_missing", "missing scope", {
          httpStatus: 404,
          tokenSource: "gh:auth-token",
        })
      )
      .mockResolvedValueOnce({ ok: true, latencyMs: 7, httpStatus: 200 });
    mockCreateProvider.mockReturnValue({
      id: "github-copilot",
      displayName: "GitHub Copilot",
      supportsTools: true,
      complete: jest.fn(),
      stream: jest.fn(),
      ping,
    });
    const tab = new SettingsTab(plugin.app, plugin);

    await (tab as unknown as { testConnection(): Promise<void> }).testConnection();
    tab.display();

    const refreshBtn = Array.from(
      tab.containerEl.querySelectorAll<HTMLButtonElement>(".error-actions button")
    ).find((el) => el.textContent === "Refresh gh scope");
    expect(refreshBtn).toBeDefined();
    refreshBtn?.click();
    for (let i = 0; i < 20; i += 1) await flushPromises();

    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["auth", "refresh", "-s", "copilot"],
      { timeout: 60000 },
      expect.any(Function)
    );
    expect(mockClearGitHubTokenCache).toHaveBeenCalled();
    expect(sessionTokenStore.clear).toHaveBeenCalled();
    expect(ping).toHaveBeenCalledTimes(2);
  });
});
