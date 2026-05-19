import type { App } from "obsidian";
import { ConsentModal } from "../security/ConsentModal";
import type { ConsentDecision as SecurityConsentDecision } from "../security/types";
import type { ConsentDecision, ToolCall, ToolCallStatus } from "./types";

const STATUS_LABELS: Record<ToolCallStatus, string> = {
  pending: "Pending",
  "awaiting-consent": "Awaiting consent",
  running: "Running",
  success: "Success",
  error: "Error",
  aborted: "Aborted",
};

export class ToolMessage {
  private readonly container: HTMLElement;
  private readonly toolCall: ToolCall;
  private readonly app?: App;
  private readonly onConsent?: (decision: ConsentDecision) => void;

  constructor(
    container: HTMLElement,
    toolCall: ToolCall,
    app?: App,
    onConsent?: (decision: ConsentDecision) => void
  ) {
    this.container = container;
    this.toolCall = toolCall;
    this.app = app;
    this.onConsent = onConsent;
  }

  render(): HTMLElement {
    const root = this.container.createDiv({ cls: "github-copilot-tool-message" });
    root.createSpan({
      cls: `github-copilot-tool-status github-copilot-tool-status-${this.toolCall.status}`,
      text: STATUS_LABELS[this.toolCall.status],
    });
    root.createSpan({
      cls: "github-copilot-tool-title",
      text: ` ${this.toolCall.serverName}.${this.toolCall.name}`,
    });
    this.renderAnnotationBadges(root);
    this.renderDetails(root, "Args", JSON.stringify(this.toolCall.arguments, null, 2));
    if (this.toolCall.result) {
      this.renderDetails(root, "Result", this.toolCall.result);
    }
    if (this.toolCall.error) {
      this.renderDetails(root, "Error", this.toolCall.error);
    }
    if (this.toolCall.status === "awaiting-consent" && this.app && this.onConsent) {
      new ConsentModal(
        this.app,
        {
          tool: {
            name: this.toolCall.name,
            serverId: this.toolCall.serverName,
            qualifiedName: `${this.toolCall.serverName}__${this.toolCall.name}`,
          },
          serverId: this.toolCall.serverName,
          conversationId: "current",
          args: this.toolCall.arguments,
          annotations: this.toolCall.annotations,
        },
        (decision) => this.onConsent?.(toChatConsentDecision(decision))
      ).open();
    }
    return root;
  }

  private renderAnnotationBadges(root: HTMLElement): void {
    const annotations = this.toolCall.annotations;
    if (!annotations) {
      return;
    }
    if (annotations.readOnlyHint) {
      root.createSpan({
        cls: "github-copilot-tool-badge github-copilot-tool-badge-readonly",
        text: " 🔒 readOnly",
      });
    }
    if (annotations.destructiveHint) {
      root.createSpan({
        cls: "github-copilot-tool-badge github-copilot-tool-badge-destructive",
        text: " ⚠️ destructive",
      });
    }
    if (annotations.openWorldHint) {
      root.createSpan({
        cls: "github-copilot-tool-badge github-copilot-tool-badge-openworld",
        text: " 🌐 openWorld",
      });
    }
  }

  private renderDetails(root: HTMLElement, label: string, value: string): void {
    const details = root.createEl("details", { cls: "github-copilot-tool-details" });
    details.createEl("summary", { text: label });
    details.createEl("pre", { text: value });
  }
}

function toChatConsentDecision(decision: SecurityConsentDecision): ConsentDecision {
  if (decision.type === "allow-session") return "allow-session";
  if (decision.type === "allow-forever") return "allow-session";
  if (decision.type === "allow-once") return "allow-once";
  if (decision.type === "deny-forever") return "deny-always";
  return "deny-once";
}
