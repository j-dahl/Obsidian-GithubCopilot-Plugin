/* eslint-disable no-undef */
import * as path from "node:path";

const mockExecFile = jest.fn();
const mockExistsSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockRmSync = jest.fn();
const mockHomedir = jest.fn(() => "/tmp/test-home");
const mockPlatform = jest.fn(() => "linux");

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

function mockCliFailureUntil(
  handler: (
    file: string,
    args: string[],
    opts: unknown,
    cb: (error: Error | null, value?: { stdout: string; stderr?: string }) => void
  ) => boolean
): void {
  mockExecFile.mockImplementation(
    (
      file: string,
      args: string[],
      opts: unknown,
      cb: (error: Error | null, value?: { stdout: string; stderr?: string }) => void
    ) => {
      if (!handler(file, args, opts, cb)) cb(new Error("missing"));
    }
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

  test("tries Copilot credential manager before gh for copilot purpose", async () => {
    mockPlatform.mockReturnValue("win32");
    const calls: string[] = [];
    mockCliFailureUntil((file, args, _opts, cb) => {
      calls.push(`${file} ${args.join(" ")}`);
      if (file === "powershell.exe") {
        cb(null, {
          stdout: JSON.stringify({
            target: "copilot-cli/https://github.com:jordand_microsoft",
            user: "https://github.com:jordand_microsoft",
            password: "gho_copilot-license",
          }),
        });
        return true;
      }
      return false;
    });

    await expect(getGitHubToken({ purpose: "copilot" })).resolves.toMatchObject({
      source: "copilot-cli:cred-manager:copilot-cli/https://github.com:jordand_microsoft",
      token: "gho_copilot-license",
    });
    expect(calls.some((call) => call.startsWith("powershell.exe "))).toBe(true);
    expect(calls.some((call) => call.startsWith("gh auth token"))).toBe(false);
  });

  test("tries Copilot CLI token print commands after gh is unavailable", async () => {
    mockCliFailureUntil((file, args, _opts, cb) => {
      if (file === "copilot" && args.join(" ") === "auth token") {
        cb(null, { stdout: "github_pat_cli-print\n" });
        return true;
      }
      return false;
    });
    await expect(getGitHubToken()).resolves.toMatchObject({
      source: "copilot-cli:cli-print",
      token: "github_pat_cli-print",
    });
  });

  test("finds Windows Credential Manager raw Copilot CLI token", async () => {
    mockPlatform.mockReturnValue("win32");
    const token = `gho_${"x".repeat(36)}`;
    mockCliFailureUntil((file, _args, _opts, cb) => {
      if (file === "powershell.exe") {
        cb(null, {
          stdout: JSON.stringify([
            {
              target: "copilot-cli/https://github.com:jordand_microsoft",
              user: "https://github.com:jordand_microsoft",
              password: token,
            },
          ]),
        });
        return true;
      }
      return false;
    });
    await expect(getGitHubToken()).resolves.toMatchObject({
      source: "copilot-cli:cred-manager:copilot-cli/https://github.com:jordand_microsoft",
      token,
    });
  });

  test("finds Windows Credential Manager JSON-wrapped Copilot CLI token", async () => {
    mockPlatform.mockReturnValue("win32");
    mockCliFailureUntil((file, _args, _opts, cb) => {
      if (file === "powershell.exe") {
        cb(null, {
          stdout: JSON.stringify({
            target: "copilot-cli/https://github.com:octocat",
            user: "https://github.com:octocat",
            password: JSON.stringify({ oauth_token: "ghu_windows-json" }),
          }),
        });
        return true;
      }
      return false;
    });
    await expect(getGitHubToken()).resolves.toMatchObject({
      source: "copilot-cli:cred-manager:copilot-cli/https://github.com:octocat",
      token: "ghu_windows-json",
    });
  });

  test("finds macOS Keychain Copilot CLI token by account", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockCliFailureUntil((file, args, _opts, cb) => {
      if (file === "security" && args.includes("-g")) {
        cb(null, { stdout: "", stderr: '"acct"<blob>="github.com"' });
        return true;
      }
      if (file === "security" && args.includes("-w")) {
        cb(null, { stdout: JSON.stringify({ accessToken: "gho_mac-json" }) });
        return true;
      }
      return false;
    });
    await expect(getGitHubToken()).resolves.toMatchObject({
      source: "copilot-cli:keychain:github.com",
      token: "gho_mac-json",
    });
  });

  test("finds Linux libsecret Copilot CLI token", async () => {
    mockPlatform.mockReturnValue("linux");
    mockCliFailureUntil((file, args, _opts, cb) => {
      if (file === "secret-tool" && args[0] === "lookup") {
        cb(null, { stdout: "github_pat_libsecret\n" });
        return true;
      }
      return false;
    });
    await expect(getGitHubToken()).resolves.toMatchObject({
      source: "copilot-cli:libsecret",
      token: "github_pat_libsecret",
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
    expect(mockExecFile).toHaveBeenCalledTimes(5);
    expect(mockExistsSync).toHaveBeenCalled();
  });
});
