/* eslint-disable obsidianmd/ui/sentence-case */
import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { DeviceFlowProgress } from "./types";

export class DeviceFlowModal extends Modal {
  private readonly abortController: AbortController;
  private progress: DeviceFlowProgress | null = null;
  private statusText = "Waiting for you to approve…";
  private didCancel = false;

  constructor(app: App, abortController: AbortController = new AbortController()) {
    super(app);
    this.abortController = abortController;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    if (!this.didCancel && !this.abortController.signal.aborted) return;
    this.abortController.abort();
  }

  updateProgress(progress: DeviceFlowProgress): void {
    this.progress = progress;
    this.render();
  }

  setStatus(message: string): void {
    this.statusText = message;
    this.render();
  }

  private cancel(): void {
    this.didCancel = true;
    this.abortController.abort();
    this.close();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("github-copilot-device-flow-modal");
    root.createEl("h2", { text: "Sign in to GitHub" });
    root.createEl("p", {
      text: "Open GitHub in your browser, enter this code, and approve access for Obsidian GitHub Copilot Agent.",
    });
    if (this.progress) {
      root.createEl("div", { text: this.progress.userCode, cls: "github-copilot-device-code" });
      const copyButton = root.createEl("button", { text: "Copy code" });
      copyButton.addEventListener(
        "click",
        () => void navigator.clipboard?.writeText(this.progress?.userCode ?? "")
      );
      const link = root.createEl("a", {
        text: this.progress.verificationUri,
        attr: { href: this.progress.verificationUri },
      });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        window.open(this.progress?.verificationUri, "_blank", "noopener");
      });
    }
    const status = root.createDiv({ cls: "github-copilot-device-flow-status" });
    status.createSpan({ text: "◌ ", cls: "github-copilot-device-flow-spinner" });
    status.createSpan({ text: this.statusText });
    const cancelButton = root.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.cancel());
  }
}
