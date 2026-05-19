import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import type { DiscoveredServer, McpConfigSource, McpServerConfig, McpTransport } from "./types";
export type { DiscoveredServer } from "./types";

interface SourceDescriptor {
  source: McpConfigSource;
  filePath: string;
  key: "servers" | "mcpServers" | "context_servers";
  httpUrlField: "url" | "serverUrl";
}

type JsonObject = Record<string, unknown>;

export async function discoverAllConfigs(cwd: string = process.cwd()): Promise<DiscoveredServer[]> {
  const discovered: DiscoveredServer[] = [];

  await Promise.all(
    getSourceDescriptors(cwd).map(async (descriptor: SourceDescriptor): Promise<void> => {
      const json = await readJsonFile(descriptor.filePath);
      if (!json) {
        return;
      }

      const container = json[descriptor.key];
      if (!isRecord(container)) {
        return;
      }

      for (const [name, rawConfig] of Object.entries(container)) {
        if (!isRecord(rawConfig)) {
          continue;
        }

        const config = normalizeServerConfig(name, rawConfig, descriptor.httpUrlField);
        if (config) {
          discovered.push({ config, source: descriptor.source });
        }
      }
    })
  );

  return discovered;
}

function getSourceDescriptors(cwd: string): SourceDescriptor[] {
  const home = os.homedir();
  const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");

  return [
    {
      source: "vscode-workspace",
      filePath: path.join(cwd, ".vscode", "mcp.json"),
      key: "servers",
      httpUrlField: "url",
    },
    {
      source: "vscode-user",
      filePath: path.join(appData, "Code", "User", "mcp.json"),
      key: "servers",
      httpUrlField: "url",
    },
    {
      source: "vscode-user",
      filePath: path.join(home, "Library", "Application Support", "Code", "User", "mcp.json"),
      key: "servers",
      httpUrlField: "url",
    },
    {
      source: "vscode-user",
      filePath: path.join(home, ".config", "Code", "User", "mcp.json"),
      key: "servers",
      httpUrlField: "url",
    },
    {
      source: "vscode-insiders-user",
      filePath: path.join(appData, "Code - Insiders", "User", "mcp.json"),
      key: "servers",
      httpUrlField: "url",
    },
    {
      source: "vscode-insiders-user",
      filePath: path.join(
        home,
        "Library",
        "Application Support",
        "Code - Insiders",
        "User",
        "mcp.json"
      ),
      key: "servers",
      httpUrlField: "url",
    },
    {
      source: "vscode-insiders-user",
      filePath: path.join(home, ".config", "Code - Insiders", "User", "mcp.json"),
      key: "servers",
      httpUrlField: "url",
    },
    {
      source: "copilot-cli",
      filePath: path.join(home, ".copilot", "mcp-config.json"),
      key: "mcpServers",
      httpUrlField: "url",
    },
    {
      source: "cursor-user",
      filePath: path.join(home, ".cursor", "mcp.json"),
      key: "mcpServers",
      httpUrlField: "url",
    },
    {
      source: "cursor-project",
      filePath: path.join(cwd, ".cursor", "mcp.json"),
      key: "mcpServers",
      httpUrlField: "url",
    },
    {
      source: "claude-desktop",
      filePath: path.join(appData, "Claude", "claude_desktop_config.json"),
      key: "mcpServers",
      httpUrlField: "url",
    },
    {
      source: "claude-desktop",
      filePath: path.join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json"
      ),
      key: "mcpServers",
      httpUrlField: "url",
    },
    {
      source: "windsurf",
      filePath: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
      key: "mcpServers",
      httpUrlField: "serverUrl",
    },
    {
      source: "zed",
      filePath: path.join(home, ".config", "zed", "settings.json"),
      key: "context_servers",
      httpUrlField: "url",
    },
    {
      source: "jetbrains-user",
      filePath: path.join(appData, "JetBrains", "MCP", "mcp.json"),
      key: "servers",
      httpUrlField: "url",
    },
    {
      source: "jetbrains-user",
      filePath: path.join(home, "Library", "Application Support", "JetBrains", "MCP", "mcp.json"),
      key: "servers",
      httpUrlField: "url",
    },
    {
      source: "jetbrains-user",
      filePath: path.join(home, ".config", "JetBrains", "MCP", "mcp.json"),
      key: "servers",
      httpUrlField: "url",
    },
  ];
}

async function readJsonFile(filePath: string): Promise<JsonObject | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    console.warn(`Unable to parse MCP config at ${filePath}`, error);
    return null;
  }
}

function normalizeServerConfig(
  name: string,
  raw: JsonObject,
  httpUrlField: "url" | "serverUrl"
): McpServerConfig | null {
  const transport = normalizeTransport(raw, httpUrlField);
  if (!transport) {
    return null;
  }

  const env = readStringRecord(raw.env);
  const autoStart = typeof raw.autoStart === "boolean" ? raw.autoStart : undefined;

  return {
    name,
    transport,
    ...(autoStart === undefined ? {} : { autoStart }),
    ...(env ? { env } : {}),
  };
}

function normalizeTransport(
  raw: JsonObject,
  httpUrlField: "url" | "serverUrl"
): McpTransport | null {
  const url = readString(raw[httpUrlField]) ?? readString(raw.url) ?? readString(raw.serverUrl);
  if (url) {
    const headers = readHeaders(raw);
    const declaredType = readString(raw.type) ?? readString(raw.transport);
    const type = declaredType === "sse" ? "sse" : "http";
    return { type, url, ...(headers ? { headers } : {}) };
  }

  const command = readString(raw.command);
  if (!command) {
    return null;
  }

  const args = readStringArray(raw.args);
  const env = readStringRecord(raw.env);
  const cwd = readString(raw.cwd);

  return {
    type: "stdio",
    command,
    ...(args ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
  };
}

function readHeaders(raw: JsonObject): Record<string, string> | undefined {
  const headers = readStringRecord(raw.headers);
  if (headers) {
    return headers;
  }

  if (!isRecord(raw.requestInit)) {
    return undefined;
  }

  return readStringRecord(raw.requestInit.headers);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((entry: unknown): entry is string => typeof entry === "string")
  ) {
    return undefined;
  }

  return value;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry: [string, unknown]): entry is [string, string] => typeof entry[1] === "string"
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface FileReadError extends Error {
  code?: string;
}

function isNodeError(error: unknown): error is FileReadError {
  return error instanceof Error && "code" in error;
}

export const McpDiscovery = { discoverAllConfigs };
