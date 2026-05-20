/* eslint-disable no-restricted-globals */
import { chromium, type Browser } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

const DEFAULT_OBSIDIAN_PATHS = [
  "C:\\Users\\jordand\\AppData\\Local\\Obsidian\\Obsidian.exe",
  "C:\\Users\\jordand\\AppData\\Local\\Programs\\Obsidian\\Obsidian.exe",
  "C:\\Program Files\\Obsidian\\Obsidian.exe",
];

export const OBSIDIAN_EXE =
  process.env.OBSIDIAN_EXE ?? DEFAULT_OBSIDIAN_PATHS.find((path) => existsSync(path)) ?? "";
export const VAULT = process.env.OBSIDIAN_TEST_VAULT ?? "C:\\Users\\jordand\\Obsidian-Test-Vault";
const USER_DATA_DIR =
  process.env.OBSIDIAN_E2E_USER_DATA_DIR ?? "C:\\Users\\jordand\\AppData\\Roaming\\obsidian-e2e";

function seedVaultRegistry(): void {
  mkdirSync(USER_DATA_DIR, { recursive: true });
  mkdirSync(`${VAULT}\\.obsidian`, { recursive: true });
  writeFileSync(`${VAULT}\\.obsidian\\app.json`, JSON.stringify({ safeMode: false }));
  writeFileSync(
    `${VAULT}\\.obsidian\\community-plugins.json`,
    JSON.stringify(["hot-reload", "github-copilot-agent"], null, 2)
  );
  writeFileSync(
    `${USER_DATA_DIR}\\obsidian.json`,
    JSON.stringify({
      vaults: {
        "obsidian-test-vault": {
          path: VAULT,
          ts: Date.now(),
          open: true,
        },
      },
    })
  );
}

export async function launchObsidian(): Promise<{
  browser: Browser;
  proc: ChildProcess;
  cleanup: () => Promise<void>;
}> {
  if (!OBSIDIAN_EXE) {
    throw new Error(
      `Obsidian.exe not found. Set OBSIDIAN_EXE or install Obsidian in one of: ${DEFAULT_OBSIDIAN_PATHS.join(", ")}`
    );
  }

  seedVaultRegistry();
  const proc = spawn(
    OBSIDIAN_EXE,
    [
      "--remote-debugging-port=9222",
      `--user-data-dir=${USER_DATA_DIR}`,
      "obsidian://open?vault=obsidian-test-vault",
    ],
    {
      detached: false,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1",
      },
    }
  );

  let lastError: unknown;
  for (let i = 0; i < 45; i += 1) {
    try {
      const response = await fetch("http://127.0.0.1:9222/json/version");
      if (response.ok) {
        const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
        return {
          browser,
          proc,
          cleanup: async () => {
            await browser.close().catch(() => undefined);
            proc.kill("SIGTERM");
          },
        };
      }
    } catch (error) {
      lastError = error;
    }
    await wait(1000);
  }

  proc.kill("SIGTERM");
  throw new Error(`Obsidian CDP endpoint did not start: ${String(lastError)}`);
}
