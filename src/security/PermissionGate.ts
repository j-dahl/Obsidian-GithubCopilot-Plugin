import type { McpServerPermissions, PermissionContext, ToolAnnotations, ToolPolicy } from "./types";
import type { PermissionDecision, ToolCall } from "../chat/types";

interface RuntimePermissionSettings {
  allowReadActiveFile: boolean;
  allowReadVaultFiles: boolean;
  allowWriteVaultFiles: boolean;
  blockDestructiveTools: boolean;
  requireConsentForOpenWorld: boolean;
  mcpServers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    autoApproveReadOnly: boolean;
    autoApproveAll: boolean;
    disabledTools: string[];
  }>;
}

export interface PermissionEvaluation {
  policy: ToolPolicy;
  reason: string;
}

function qualifiedToolName(ctx: PermissionContext): string {
  const serverId = ctx.tool.serverId ?? "native";
  return ctx.tool.qualifiedName ?? `${serverId}__${ctx.tool.name}`;
}

function normalizedAnnotations(
  annotations: ToolAnnotations | undefined
): Required<ToolAnnotations> {
  return {
    readOnlyHint: annotations?.readOnlyHint ?? false,
    destructiveHint: annotations?.destructiveHint ?? true,
    idempotentHint: annotations?.idempotentHint ?? false,
    openWorldHint: annotations?.openWorldHint ?? true,
  };
}

function serverPermissions(ctx: PermissionContext): McpServerPermissions {
  const serverId = ctx.tool.serverId ?? "native";
  return (
    ctx.settings.mcpServers[serverId] ?? {
      serverId,
      disabledTools: [],
      toolPolicies: {},
      autoApproveReadOnly: false,
      autoApproveAll: false,
    }
  );
}

function decision(policy: ToolPolicy, reason: string): PermissionEvaluation {
  return { policy, reason };
}

export function evaluate(ctx: PermissionContext): PermissionEvaluation {
  const annotations = normalizedAnnotations(ctx.annotations);
  const qualifiedName = qualifiedToolName(ctx);
  const server = serverPermissions(ctx);
  const configuredPolicy =
    ctx.scope === "mcp"
      ? (server.toolPolicies[ctx.tool.name] ?? server.toolPolicies[qualifiedName])
      : (ctx.settings.nativeToolPolicies[ctx.tool.name] ??
        ctx.settings.nativeToolPolicies[qualifiedName]);

  if (ctx.scope === "mcp" && server.disabled) {
    return decision("deny", "server disabled by policy");
  }

  if (
    ctx.scope === "mcp" &&
    (server.disabledTools.includes(ctx.tool.name) || server.disabledTools.includes(qualifiedName))
  ) {
    return decision("deny", "tool disabled by policy");
  }

  if (ctx.settings.blockDestructiveTools && annotations.destructiveHint) {
    return decision("deny", "destructive tools blocked by policy");
  }

  if (ctx.sessionAllowed.has(qualifiedName)) {
    return decision("auto-allow", "allowed for this conversation");
  }

  if (configuredPolicy === "deny") {
    return decision("deny", "tool denied by saved policy");
  }

  if (configuredPolicy === "auto-allow") {
    return decision("auto-allow", "tool allowed by saved policy");
  }

  if (configuredPolicy === "ask") {
    return decision("ask", "tool requires approval by saved policy");
  }

  if (ctx.scope === "mcp" && server.autoApproveReadOnly && annotations.readOnlyHint) {
    return decision("auto-allow", "read-only tool auto-approved for server");
  }

  if (ctx.scope === "mcp" && server.autoApproveAll) {
    return decision("auto-allow", "all tools auto-approved for server");
  }

  if (ctx.scope === "mcp" && annotations.readOnlyHint) {
    return decision(ctx.settings.mcpReadOnlyTools, "MCP read-only preset policy");
  }

  if (ctx.scope === "mcp" && annotations.openWorldHint) {
    if (ctx.settings.networkEgress === "deny") {
      return decision("deny", "network egress denied by preset");
    }
    if (ctx.settings.networkEgress === "ask") {
      return decision("ask", "network egress requires approval");
    }
  }

  if (ctx.scope === "mcp" && annotations.destructiveHint) {
    return decision(ctx.settings.mcpDestructiveTools, "MCP destructive preset policy");
  }

  return decision("ask", "default approval required");
}

export class PermissionGate {
  constructor(private readonly getSettings: () => RuntimePermissionSettings) {}

  evaluate(toolCall: ToolCall): PermissionDecision {
    const settings = this.getSettings();
    const annotations = normalizedAnnotations(toolCall.annotations);
    const server = settings.mcpServers.find(
      (entry) => entry.id === toolCall.serverName || entry.name === toolCall.serverName
    );

    if (server && !server.enabled) {
      return { action: "deny", reason: "server disabled by policy" };
    }
    if (server?.disabledTools.includes(toolCall.name)) {
      return { action: "deny", reason: "tool disabled by policy" };
    }
    if (settings.blockDestructiveTools && annotations.destructiveHint) {
      return { action: "deny", reason: "destructive tools blocked by policy" };
    }
    if (server?.autoApproveAll || (server?.autoApproveReadOnly && annotations.readOnlyHint)) {
      return { action: "auto-allow" };
    }
    if (toolCall.serverName === "obsidian-native") {
      if (toolCall.name === "read_active_file" && settings.allowReadActiveFile) {
        return { action: "auto-allow" };
      }
      if (annotations.readOnlyHint && settings.allowReadVaultFiles) {
        return { action: "auto-allow" };
      }
      if (!annotations.readOnlyHint && settings.allowWriteVaultFiles) {
        return { action: "ask", reason: "write tool requires approval" };
      }
    }
    if (annotations.openWorldHint && settings.requireConsentForOpenWorld) {
      return { action: "ask", reason: "open-world tool requires approval" };
    }
    return annotations.readOnlyHint
      ? { action: "ask", reason: "read requires approval" }
      : { action: "ask", reason: "approval required" };
  }
}
