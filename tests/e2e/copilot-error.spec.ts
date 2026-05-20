/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { launchObsidian } from "./launch";

const shouldRun = process.platform === "win32" && process.env.OBSIDIAN_EXE_AVAILABLE === "1";

test.skip(!shouldRun, "Obsidian E2E requires Windows and OBSIDIAN_EXE_AVAILABLE=1");

async function workspacePage(pages: Page[]): Promise<Page> {
  const page = pages.find((candidate) => !candidate.url().startsWith("devtools://")) ?? pages[0];
  if (!page) throw new Error("No Obsidian page was exposed through CDP");
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForFunction(() => Boolean((window as typeof window & { app?: unknown }).app), {
    timeout: 45_000,
  });
  return page;
}

test("Copilot test connection renders an inline structured error or succeeds", async () => {
  const { browser, cleanup } = await launchObsidian();
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await workspacePage(context.pages());
    const trustButton = page.getByRole("button", { name: "Trust author and enable plugins" });
    if (await trustButton.isVisible().catch(() => false)) {
      await trustButton.click();
    }
    await page.waitForFunction(
      () =>
        Boolean(
          (window as typeof window & { app?: any }).app?.plugins?.plugins?.["github-copilot-agent"]
        ),
      { timeout: 30_000 }
    );

    await page.evaluate(async () => {
      const app = (window as typeof window & { app: any }).app;
      const plugin = app.plugins.plugins["github-copilot-agent"];
      if (!plugin) throw new Error("github-copilot-agent plugin is not loaded");
      plugin.settings.backend = "github-copilot";
      plugin.settings.selectedModel = "auto";
      await plugin.saveSettings?.();
      app.setting.open();
      app.setting.openTabById("github-copilot-agent");
    });

    await expect(page.locator(".modal.mod-settings")).toBeVisible({ timeout: 20_000 });
    if ((await page.locator(".setting-item-name", { hasText: /^Diagnostics$/ }).count()) === 0) {
      await page
        .locator(".vertical-tab-nav-item")
        .filter({ hasText: /^GitHub Copilot Agent$/ })
        .click();
    }

    const testButton = page.getByRole("button", { name: "Test connection" });
    await expect(testButton).toBeEnabled({ timeout: 20_000 });
    await testButton.click();

    const status = page.locator(".github-copilot-test-connection-status");
    await expect(status).not.toHaveText(/Testing/i, { timeout: 30_000 });
    const statusText = (await status.textContent()) ?? "";

    if (statusText.includes("✅") || /Connected/i.test(statusText)) {
      // Connection works for this account; no inline error block should appear.
      await expect(page.locator(".github-copilot-error-details")).toHaveCount(0);
    } else {
      // Failure path: the new inline collapsible block must be present.
      const block = page.locator(".github-copilot-error-details");
      await expect(block).toBeVisible({ timeout: 5_000 });
      await expect(block.locator(".github-copilot-error-summary .error-title")).toContainText(
        /failed|scope|HTTP/i
      );

      const metaText = (await block.locator(".error-meta").textContent()) ?? "";
      expect(metaText).toContain("Backend");
      expect(metaText).toContain("Endpoint");
      expect(metaText).toContain("HTTP status");
      expect(metaText).toContain("Error code");

      const copyBtn = block.locator(".error-actions button", { hasText: "Copy as Markdown" });
      await expect(copyBtn).toBeVisible();
    }

    await mkdir("tests\\e2e\\__screenshots__", { recursive: true });
    await page.screenshot({
      path: "tests\\e2e\\__screenshots__\\copilot-error.png",
      fullPage: true,
    });
  } finally {
    await cleanup();
  }
});
