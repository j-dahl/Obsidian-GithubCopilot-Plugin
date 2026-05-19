/* eslint-disable no-undef, @typescript-eslint/no-unsafe-return */
jest.mock("obsidian", () => jest.requireActual("./obsidianMock"), { virtual: true });

import type { App } from "obsidian";
import { DeviceFlowModal } from "../../src/auth";

const app = { vault: { adapter: {} } } as unknown as App;

describe("DeviceFlowModal", () => {
  test("renders instructions and user code", () => {
    const modal = new DeviceFlowModal(app);
    modal.open();
    modal.updateProgress({
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresInSec: 900,
      intervalSec: 5,
    });
    expect(modal.contentEl.textContent).toContain("Sign in to GitHub");
    expect(modal.contentEl.textContent).toContain("ABCD-1234");
    expect(modal.contentEl.textContent).toContain("Waiting for you to approve…");
    expect(modal.contentEl.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/login/device"
    );
  });

  test("cancel aborts the signal", () => {
    const controller = new AbortController();
    const modal = new DeviceFlowModal(app, controller);
    modal.open();
    const cancel = Array.from(modal.contentEl.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel"
    );
    cancel?.click();
    expect(controller.signal.aborted).toBe(true);
  });
});
