/* eslint-disable no-undef */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const execFileMock = jest.fn();
jest.mock("keytar", () => ({ findCredentials: jest.fn(async () => []) }));
jest.mock("node:child_process", () => ({ execFile: execFileMock }));

import { getGitHubToken } from "../../src/auth/tokenSources";

type Env = NodeJS.ProcessEnv;
const originalEnv: Env = { ...process.env };
const scratchRoot = join(process.cwd(), "tests", "auth", ".tmp");

function tempHome(): string {
  mkdirSync(scratchRoot, { recursive: true });
  return mkdtempSync(join(scratchRoot, "home-"));
}

function resetEnv(): void {
  process.env = { ...originalEnv };
  delete process.env.COPILOT_GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
}

function mockGhFailure(): void {
  execFileMock.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: (error: Error) => void) =>
      cb(new Error("missing"))
  );
}

describe("getGitHubToken", () => {
  beforeEach(() => {
    resetEnv();
    execFileMock.mockReset();
    mockGhFailure();
  });

  afterAll(() => {
    process.env = originalEnv;
    rmSync(scratchRoot, { recursive: true, force: true });
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
  });

  test("uses gh auth token when env is empty", async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _opts: unknown,
        cb: (error: Error | null, value: { stdout: string }) => void
      ) => cb(null, { stdout: "ghu_from-cli\n" })
    );
    await expect(getGitHubToken({ homeDir: tempHome() })).resolves.toMatchObject({
      source: "gh:auth-token",
      token: "ghu_from-cli",
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      ["auth", "token", "--hostname", "github.com"],
      { timeout: 5000 },
      expect.any(Function)
    );
  });

  test("finds Copilot CLI tokens in config.json nested paths", async () => {
    const home = tempHome();
    mkdirSync(join(home, ".copilot"));
    writeFileSync(
      join(home, ".copilot", "config.json"),
      JSON.stringify({ auth: { nested: { access_token: "github_pat_nested" } } })
    );
    await expect(getGitHubToken({ homeDir: home })).resolves.toMatchObject({
      source: "copilot-cli:config.json:$.auth.nested.access_token",
      tokenType: "github_pat",
    });
    rmSync(home, { recursive: true, force: true });
  });

  test("finds Copilot CLI tokens in auth.json alternate shape", async () => {
    const home = tempHome();
    mkdirSync(join(home, ".copilot"));
    writeFileSync(
      join(home, ".copilot", "auth.json"),
      JSON.stringify({ accounts: [{ token: "gho_array-token" }] })
    );
    await expect(getGitHubToken({ homeDir: home })).resolves.toMatchObject({
      source: "copilot-cli:auth.json:$.accounts[0].token",
      token: "gho_array-token",
    });
    rmSync(home, { recursive: true, force: true });
  });

  test("finds VS Code Copilot token files and plugin cache after graceful skips", async () => {
    const home = tempHome();
    const local = join(home, "local");
    mkdirSync(join(local, "github-copilot"), { recursive: true });
    writeFileSync(
      join(local, "github-copilot", "apps.json"),
      JSON.stringify({ "github.com:Iv1.b507a08c87ecfe98": { oauth_token: "ghu_vscode" } })
    );
    await expect(getGitHubToken({ homeDir: home, localAppData: local })).resolves.toMatchObject({
      source: "copilot-file:apps.json",
      token: "ghu_vscode",
    });
    const adapter = {
      exists: jest.fn(async () => true),
      read: jest.fn(async () => JSON.stringify({ token: "gho_cache" })),
    };
    await expect(
      getGitHubToken({
        homeDir: tempHome(),
        localAppData: join(tempHome(), "none"),
        pluginCache: { adapter },
      })
    ).resolves.toMatchObject({ source: "plugin:cache", token: "gho_cache" });
    rmSync(home, { recursive: true, force: true });
  });

  test("returns null when every tier is unavailable", async () => {
    await expect(
      getGitHubToken({ homeDir: tempHome(), localAppData: join(tempHome(), "missing") })
    ).resolves.toBeNull();
  });
});
