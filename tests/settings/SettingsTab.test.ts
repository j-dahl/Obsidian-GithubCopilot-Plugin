import { App } from "obsidian";
import { SettingsTab, DEFAULT_SETTINGS, type PluginSettings } from "../../src/settings";
import { clickButton, settingCalls } from "../obsidianMock";
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

    expect(
      settingCalls.some((call) => call.method === "Notice" && String(call.value).includes(hint))
    ).toBe(true);
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

    expect(
      settingCalls.some(
        (call) =>
          call.method === "Notice" &&
          String(call.value).includes("missing the required `copilot` scope")
      )
    ).toBe(true);
    expect(settingCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "component.setButtonText", value: "Refresh gh scope" }),
        expect.objectContaining({
          method: "component.setButtonText",
          value: "Sign in via device flow",
        }),
      ])
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
    await clickButton("Refresh gh scope");

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
