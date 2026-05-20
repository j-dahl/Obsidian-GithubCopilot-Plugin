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

test("settings render and chat input stays visible", async () => {
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
    await expect(page.locator(".github-copilot-settings-section-error")).toHaveCount(0);
    await expect(page.locator(".setting-item-name", { hasText: /^Diagnostics$/ })).toBeVisible();
    await expect(page.locator(".setting-item-name", { hasText: /^Model$/ })).toBeVisible();
    await expect(page.locator(".setting-item-name", { hasText: /^MCP servers$/ })).toBeVisible();

    const copilotOptionCount = await page
      .locator("select option")
      .evaluateAll(
        (options) =>
          options.filter((option) =>
            ["auto", "claude-sonnet-4.6", "claude-opus-4.7", "gpt-5.5", "gpt-4o"].includes(
              (option as HTMLOptionElement).value
            )
          ).length
      );
    expect(copilotOptionCount).toBeGreaterThanOrEqual(5);
    await expect(page.getByRole("button", { name: "Test connection" })).toBeEnabled();

    await page.keyboard.press("Escape");
    await page.evaluate(async () => {
      const app = (window as typeof window & { app: any }).app;
      await app.commands.executeCommandById("github-copilot-agent:open-chat");
    });

    await expect(page.locator(".github-copilot-chat-root")).toBeVisible({ timeout: 20_000 });
    const textarea = page.locator(".github-copilot-chat-textarea");
    await expect(textarea).toBeVisible();
    const box = await textarea.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(40);

    await textarea.fill("smoke test");
    await textarea.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    if ((await page.locator(".github-copilot-chat-row-user").count()) === 0) {
      await page.locator(".github-copilot-chat-send").evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
    }
    await expect(page.locator(".github-copilot-chat-row-user")).toContainText("smoke test");
    await page
      .locator(".github-copilot-chat-row-assistant, .github-copilot-chat-auth-message")
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => undefined);

    await mkdir("tests\\e2e\\__screenshots__", { recursive: true });
    await page.screenshot({ path: "tests\\e2e\\__screenshots__\\smoke.png", fullPage: true });
  } finally {
    await cleanup();
  }
});
