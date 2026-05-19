import { App } from "obsidian";
import { SettingsTab, DEFAULT_SETTINGS, type PluginSettings } from "../../src/settings";
import { settingCalls } from "../obsidianMock";
import { getGitHubToken } from "../../src/auth";
import { discoverAllConfigs } from "../../src/mcp/McpDiscovery";
import { getModels } from "../../src/providers/catalog";
import { createProvider } from "../../src/providers/factory";
import { ProviderError } from "../../src/providers/types";

jest.mock("../../src/auth", () => ({ getGitHubToken: jest.fn(async () => null) }));
jest.mock("../../src/mcp/McpDiscovery", () => ({ discoverAllConfigs: jest.fn(async () => []) }));
jest.mock("../../src/providers/catalog", () => ({ getModels: jest.fn(async () => []) }));
jest.mock("../../src/providers/factory", () => ({ createProvider: jest.fn() }));

const mockGetGitHubToken = getGitHubToken as jest.MockedFunction<typeof getGitHubToken>;
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

    expect(mockGetGitHubToken).toHaveBeenCalledTimes(1);
    expect(mockDiscoverAllConfigs).toHaveBeenCalledTimes(1);
    expect(mockGetModels).toHaveBeenCalledTimes(1);
    expect(settingCalls.length).toBeGreaterThan(0);
    expect(
      settingCalls.filter((call) => call.method === "setName").map((call) => call.value)
    ).toEqual(expect.arrayContaining(["Backend", "Model", "MCP servers", "Diagnostics"]));
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

    expect(settingCalls.some((call) => call.method === "Notice" && String(call.value).includes(hint)))
      .toBe(true);
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
});
