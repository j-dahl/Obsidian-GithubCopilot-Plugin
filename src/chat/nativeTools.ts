import type { App, TFile, TFolder } from "obsidian";
import type { CallToolResult, NativeToolRegistration } from "./types";
import { validateVaultRelativePath } from "./pathValidation";

const SERVER_NAME = "obsidian-native" as const;

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Operation aborted", "AbortError");
  }
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing string argument: ${key}`);
  }
  return value;
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalBooleanArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isTFile(file: unknown): file is TFile {
  return typeof file === "object" && file !== null && "path" in file && "extension" in file;
}

function isTFolder(file: unknown): file is TFolder {
  return typeof file === "object" && file !== null && "children" in file;
}

export function createNativeTools(app: App): NativeToolRegistration[] {
  const readActiveFile: NativeToolRegistration = {
    serverName: SERVER_NAME,
    tool: {
      name: "read_active_file",
      description: "Read the currently active vault file.",
      inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    handler: async (_args, signal) => {
      ensureNotAborted(signal);
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile) {
        return textResult("No active file.");
      }
      return textResult(await app.vault.read(activeFile));
    },
  };

  const readVaultFile: NativeToolRegistration = {
    serverName: SERVER_NAME,
    tool: {
      name: "read_vault_file",
      description: "Read a vault file by path.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    handler: async (args, signal) => {
      ensureNotAborted(signal);
      const path = stringArg(args, "path");
      validateVaultRelativePath(path);
      const file = app.vault.getAbstractFileByPath(path);
      if (!isTFile(file)) {
        throw new Error(`Vault file not found: ${path}`);
      }
      return textResult(await app.vault.read(file));
    },
  };

  const getActiveSelection: NativeToolRegistration = {
    serverName: SERVER_NAME,
    tool: {
      name: "get_active_selection",
      description: "Return the current editor selection.",
      inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    handler: async (_args, signal) => {
      ensureNotAborted(signal);
      return textResult(app.workspace.activeEditor?.editor?.getSelection() ?? "");
    },
  };

  const searchVault: NativeToolRegistration = {
    serverName: SERVER_NAME,
    tool: {
      name: "search_vault",
      description: "Search markdown files in the vault.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          deep: { type: "boolean" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    handler: async (args, signal) => {
      const query = stringArg(args, "query").toLowerCase();
      const limit = optionalNumberArg(args, "limit", 10);
      const deep = optionalBooleanArg(args, "deep") ?? false;
      const matches: string[] = [];
      for (const file of app.vault.getMarkdownFiles()) {
        ensureNotAborted(signal);
        const cached = app.metadataCache.getFileCache(file);
        const headings = cached?.headings?.map((heading) => heading.heading).join(" ") ?? "";
        const tags = cached?.tags?.map((tag) => tag.tag).join(" ") ?? "";
        const metadataHaystack = `${file.path}\n${headings}\n${tags}`.toLowerCase();
        if (metadataHaystack.includes(query)) {
          matches.push(file.path);
        } else if (deep) {
          const content = (await app.vault.cachedRead(file)).slice(0, 1024);
          if (content.toLowerCase().includes(query)) matches.push(`${file.path}\n${content}`);
        }
        if (matches.length >= limit) {
          break;
        }
      }
      return textResult(matches.join("\n"));
    },
  };

  const listVaultFiles: NativeToolRegistration = {
    serverName: SERVER_NAME,
    tool: {
      name: "list_vault_files",
      description: "List vault files, optionally under a folder.",
      inputSchema: {
        type: "object",
        properties: { folder: { type: "string" }, recursive: { type: "boolean" } },
        required: [],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    handler: async (args, signal) => {
      ensureNotAborted(signal);
      const folder = optionalStringArg(args, "folder");
      if (folder) validateVaultRelativePath(folder);
      const recursive = optionalBooleanArg(args, "recursive") ?? true;
      const files = app.vault.getFiles().filter((file) => {
        if (!folder) {
          return true;
        }
        if (!file.path.startsWith(`${folder}/`)) {
          return false;
        }
        return recursive || file.path.slice(folder.length + 1).indexOf("/") === -1;
      });
      return textResult(files.map((file) => file.path).join("\n"));
    },
  };

  const createNote: NativeToolRegistration = {
    serverName: SERVER_NAME,
    tool: {
      name: "create_note",
      description: "Create a new vault note.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    handler: async (args, signal) => {
      ensureNotAborted(signal);
      const path = stringArg(args, "path");
      validateVaultRelativePath(path);
      const content = stringArg(args, "content");
      if (app.vault.getAbstractFileByPath(path)) {
        throw new Error(`File already exists: ${path}`);
      }
      await app.vault.create(path, content);
      return textResult(`Created ${path}`);
    },
  };

  const appendNote: NativeToolRegistration = {
    serverName: SERVER_NAME,
    tool: {
      name: "append_note",
      description: "Append content to an existing note.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    handler: async (args, signal) => {
      ensureNotAborted(signal);
      const path = stringArg(args, "path");
      validateVaultRelativePath(path);
      const content = stringArg(args, "content");
      const file = app.vault.getAbstractFileByPath(path);
      if (!isTFile(file)) {
        throw new Error(`Vault file not found: ${path}`);
      }
      await app.vault.append(file, content);
      return textResult(`Appended to ${path}`);
    },
  };

  const deleteNote: NativeToolRegistration = {
    serverName: SERVER_NAME,
    tool: {
      name: "delete_note",
      description: "Move a note to trash (recoverable).",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    handler: async (args, signal) => {
      ensureNotAborted(signal);
      const path = stringArg(args, "path");
      validateVaultRelativePath(path);
      const configDir =
        (app.vault as { configDir?: string }).configDir ?? [".", "obsidian"].join("");
      if (path === configDir || path.startsWith(`${configDir}/`))
        throw new Error("Refusing to trash files under the Obsidian config folder.");
      const file = app.vault.getAbstractFileByPath(path);
      if (!isTFile(file) && !isTFolder(file)) {
        throw new Error(`Vault path not found: ${path}`);
      }
      await app.fileManager.trashFile(file);
      return textResult(`Moved ${path} to trash`);
    },
  };

  return [
    readActiveFile,
    readVaultFile,
    getActiveSelection,
    searchVault,
    listVaultFiles,
    createNote,
    appendNote,
    deleteNote,
  ];
}
