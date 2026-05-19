import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { jest } from '@jest/globals';
import { discoverAllConfigs } from '../../src/mcp/McpDiscovery';

function enoent(): NodeJS.ErrnoException {
  const error = new Error('missing') as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

describe('McpDiscovery', () => {
  const originalAppData = process.env.APPDATA;

  afterEach((): void => {
    jest.restoreAllMocks();
    process.env.APPDATA = originalAppData;
  });

  test('normalizes editor config variants into discovered servers', async (): Promise<void> => {
    process.env.APPDATA = 'C:\\Users\\me\\AppData\\Roaming';
    const home = os.homedir();

    const files = new Map<string, string>([
      [path.join('C:\\repo', '.vscode', 'mcp.json'), JSON.stringify({ servers: { vscode: { url: 'https://vscode.test/mcp', headers: { Authorization: 'Bearer token' } } } })],
      [path.join('C:\\Users\\me\\AppData\\Roaming', 'Code', 'User', 'mcp.json'), JSON.stringify({ servers: { user: { command: 'npx', args: ['server'], env: { A: 'B' } } } })],
      [path.join('C:\\Users\\me\\AppData\\Roaming', 'Code - Insiders', 'User', 'mcp.json'), JSON.stringify({ servers: { insiders: { url: 'https://insiders.test/sse', type: 'sse' } } })],
      [path.join(home, '.copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: { copilot: { command: 'uvx', autoStart: false } } })],
      [path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { cursor: { url: 'https://cursor.test' } } })],
      [path.join('C:\\repo', '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { projectCursor: { url: 'https://cursor-project.test' } } })],
      [path.join('C:\\Users\\me\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { claude: { command: 'node', args: ['server.js'] } } })],
      [path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), JSON.stringify({ mcpServers: { windsurf: { serverUrl: 'https://windsurf.test' } } })],
      [path.join(home, '.config', 'zed', 'settings.json'), JSON.stringify({ context_servers: { zed: { url: 'https://zed.test', requestInit: { headers: { 'X-Test': '1' } } } } })],
      [path.join('C:\\Users\\me\\AppData\\Roaming', 'JetBrains', 'MCP', 'mcp.json'), JSON.stringify({ servers: { jetbrains: { command: 'jb-mcp' } } })],
    ]);

    jest.spyOn(fs, 'readFile').mockImplementation(async (file: fs.PathLike | FileHandle): Promise<string> => {
      const filePath = String(file);
      const entry = files.get(filePath);
      if (!entry) {
        throw enoent();
      }
      return entry;
    });

    const discovered = await discoverAllConfigs('C:\\repo');

    expect(discovered).toHaveLength(10);
    expect(discovered).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'vscode-workspace', config: expect.objectContaining({ name: 'vscode', transport: expect.objectContaining({ type: 'http', url: 'https://vscode.test/mcp' }) }) }),
      expect.objectContaining({ source: 'vscode-user', config: expect.objectContaining({ name: 'user', transport: expect.objectContaining({ type: 'stdio', command: 'npx', args: ['server'] }) }) }),
      expect.objectContaining({ source: 'vscode-insiders-user', config: expect.objectContaining({ name: 'insiders', transport: expect.objectContaining({ type: 'sse' }) }) }),
      expect.objectContaining({ source: 'copilot-cli', config: expect.objectContaining({ name: 'copilot', autoStart: false }) }),
      expect.objectContaining({ source: 'cursor-user', config: expect.objectContaining({ name: 'cursor' }) }),
      expect.objectContaining({ source: 'cursor-project', config: expect.objectContaining({ name: 'projectCursor' }) }),
      expect.objectContaining({ source: 'claude-desktop', config: expect.objectContaining({ name: 'claude' }) }),
      expect.objectContaining({ source: 'windsurf', config: expect.objectContaining({ name: 'windsurf', transport: expect.objectContaining({ url: 'https://windsurf.test' }) }) }),
      expect.objectContaining({ source: 'zed', config: expect.objectContaining({ name: 'zed', transport: expect.objectContaining({ headers: { 'X-Test': '1' } }) }) }),
      expect.objectContaining({ source: 'jetbrains-user', config: expect.objectContaining({ name: 'jetbrains' }) }),
    ]));
  });

  test('warns on unparseable files and continues', async (): Promise<void> => {
    const warn = jest.spyOn(console, 'warn').mockImplementation((): void => undefined);
    jest.spyOn(fs, 'readFile').mockImplementation(async (file: fs.PathLike | FileHandle): Promise<string> => {
      if (String(file).endsWith(path.join('repo', '.vscode', 'mcp.json'))) {
        return '{not json';
      }
      throw enoent();
    });

    await expect(discoverAllConfigs('C:\\repo')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
