/* eslint-disable no-undef */
import * as path from "node:path";

const mockExecFile = jest.fn();
const mockExistsSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockRmSync = jest.fn();
const mockHomedir = jest.fn(() => "/tmp/test-home");
const mockPlatform = jest.fn(() => "linux");
const mockFindCredentials = jest.fn(async () => []);

jest.mock("keytar", () => ({ findCredentials: mockFindCredentials }));
jest.mock("node:child_process", () => ({ execFile: mockExecFile }));
jest.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  rmSync: mockRmSync,
}));
jest.mock("node:os", () => ({ homedir: mockHomedir, platform: mockPlatform }));

import { getGitHubToken } from "../../src/auth/tokenSources";

type Env = NodeJS.ProcessEnv;
const originalEnv: Env = { ...process.env };
const files = new Map<string, string>();
const directories = new Set<string>();

function resetEnv(): void {
  process.env = { ...originalEnv };
  delete process.env.COPILOT_GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
}

function mockGhFailure(): void {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: (error: Error) => void) =>
      cb(new Error("missing"))
  );
}

function addFile(filePath: string, contents: string): void {
  files.set(filePath, contents);
  directories.add(path.dirname(filePath));
}

describe("getGitHubToken", () => {
  beforeEach(() => {
    resetEnv();
    jest.clearAllMocks();
    files.clear();
    directories.clear();
    mockHomedir.mockReturnValue("/tmp/test-home");
    mockPlatform.mockReturnValue("linux");
    mockFindCredentials.mockResolvedValue([]);
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
    mockGhFailure();
    mockExistsSync.mockImplementation(
      (filePath: string) => files.has(filePath) || directories.has(filePath)
    );
    mockReaddirSync.mockImplementation((dir: string) => {
      if (!directories.has(dir)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      const prefix = `${dir}${path.sep}`;
      return Array.from(files.keys())
        .filter((filePath) => path.dirname(filePath) === dir && filePath.startsWith(prefix))
        .map((filePath) => path.basename(filePath));
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      const contents = files.get(filePath);
      if (contents === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return contents;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetEnv();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("uses environment variables in priority order", async () => {
    process.env.GH_TOKEN = "ghu_from-gh";
    process.env.COPILOT_GITHUB_TOKEN = "gho_from-copilot";
    const logs: string[] = [];
    await expect(getGitHubToken({ debug: (line) => logs.push(line) })).resolves.toMatchObject({
      token: "gho_from-copilot",
      source: "env:COPILOT_GITHUB_TOKEN",
      tokenType: "gho",
    });
    expect(logs).toContain("[auth] tier=1 source=env:COPILOT_GITHUB_TOKEN ok");
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  test("uses gh auth token when env is empty", async () => {
    mockExecFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _opts: unknown,
        cb: (error: Error | null, value: { stdout: string }) => void
      ) => cb(null, { stdout: "ghu_from-cli\n" })
    );
    await expect(getGitHubToken()).resolves.toMatchObject({
      source: "gh:auth-token",
      token: "ghu_from-cli",
    });
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["auth", "token", "--hostname", "github.com"],
      { timeout: 5000 },
      expect.any(Function)
    );
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  test("finds keytar Copilot CLI credentials after gh is unavailable", async () => {
    mockFindCredentials.mockResolvedValue([
      { account: "github.com", password: "github_pat_keychain" },
    ]);
    await expect(getGitHubToken()).resolves.toMatchObject({
      source: "copilot-cli:keychain:github.com",
      token: "github_pat_keychain",
    });
  });

  test("finds Copilot CLI tokens in config.json nested paths", async () => {
    addFile(
      path.join("/tmp/test-home", ".copilot", "config.json"),
      JSON.stringify({ auth: { nested: { access_token: "github_pat_nested" } } })
    );
    await expect(getGitHubToken()).resolves.toMatchObject({
      source: "copilot-cli:config.json:$.auth.nested.access_token",
      tokenType: "github_pat",
    });
  });

  test("finds Copilot CLI tokens in auth.json alternate shape", async () => {
    addFile(
      path.join("/tmp/test-home", ".copilot", "auth.json"),
      JSON.stringify({ accounts: [{ token: "gho_array-token" }] })
    );
    await expect(getGitHubToken()).resolves.toMatchObject({
      source: "copilot-cli:auth.json:$.accounts[0].token",
      token: "gho_array-token",
    });
  });

  test("finds VS Code Copilot token files and plugin cache after graceful skips", async () => {
    const local = path.join("/tmp/test-home", "local");
    const tokenFile = JSON.stringify({
      "github.com:Iv1.b507a08c87ecfe98": { oauth_token: "ghu_vscode" },
    });
    addFile(path.join(local, "github-copilot", "apps.json"), tokenFile);
    addFile(path.join("/tmp/test-home", ".config", "github-copilot", "apps.json"), tokenFile);
    await expect(
      getGitHubToken({ homeDir: "/tmp/test-home", localAppData: local })
    ).resolves.toMatchObject({
      source: "copilot-file:apps.json",
      token: "ghu_vscode",
    });

    files.clear();
    directories.clear();
    const adapter = {
      exists: jest.fn(async () => true),
      read: jest.fn(async () => JSON.stringify({ token: "gho_cache" })),
    };
    await expect(getGitHubToken({ pluginCache: { adapter } })).resolves.toMatchObject({
      source: "plugin:cache",
      token: "gho_cache",
    });
  });

  test("returns null when every tier is unavailable in the CI baseline", async () => {
    await expect(getGitHubToken()).resolves.toBeNull();
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockFindCredentials).toHaveBeenCalledTimes(1);
    expect(mockExistsSync).toHaveBeenCalled();
  });
});
