import type { App, TFile } from 'obsidian';
import { createNativeTools } from '../../src/chat/nativeTools';

interface FakeFile extends TFile {
content: string;
}

function fakeFile(path: string, content: string): FakeFile {
return { path, extension: path.split('.').pop() ?? 'md', content };
}

function appWithFiles(files: FakeFile[], activeFile: FakeFile | null = null, selection = ''): App {
const byPath = new Map(files.map((file) => [file.path, file]));
const created: FakeFile[] = [];
const app = {
workspace: {
getActiveFile: () => activeFile,
activeEditor: { editor: { getSelection: () => selection } },
},
metadataCache: {
getFileCache: () => ({ headings: [{ heading: 'Heading' }] }),
},
vault: {
configDir: '.obsidian',
getMarkdownFiles: () => files,
getFiles: () => [...files, ...created],
getAbstractFileByPath: (path: string) => byPath.get(path) ?? created.find((file) => file.path === path) ?? null,
read: (file: FakeFile) => Promise.resolve(file.content),
cachedRead: (file: FakeFile) => Promise.resolve(file.content),
create: (path: string, content: string) => {
const file = fakeFile(path, content);
created.push(file);
return Promise.resolve(file);
},
append: (file: FakeFile, content: string) => {
file.content += content;
return Promise.resolve();
},
delete: (file: FakeFile) => {
byPath.delete(file.path);
return Promise.resolve();
},
},
fileManager: {
trashFile: (file: FakeFile) => {
byPath.delete(file.path);
return Promise.resolve();
},
},
};
return app as unknown as App;
}

async function callTool(app: App, name: string, args: Record<string, unknown> = {}) {
const tool = createNativeTools(app).find((item) => item.tool.name === name);
expect(tool).toBeDefined();
return tool?.handler(args, new AbortController().signal);
}

describe('nativeTools', () => {
test('read_active_file reads workspace active file', async () => {
const file = fakeFile('active.md', 'active content');
await expect(callTool(appWithFiles([file], file), 'read_active_file')).resolves.toEqual({ content: [{ type: 'text', text: 'active content' }] });
});

test('read_vault_file reads by path', async () => {
const file = fakeFile('note.md', 'note content');
await expect(callTool(appWithFiles([file]), 'read_vault_file', { path: 'note.md' })).resolves.toEqual({ content: [{ type: 'text', text: 'note content' }] });
});

test('get_active_selection returns editor selection', async () => {
await expect(callTool(appWithFiles([], null, 'selected'), 'get_active_selection')).resolves.toEqual({ content: [{ type: 'text', text: 'selected' }] });
});

test('search_vault returns matching file paths', async () => {
const first = fakeFile('a.md', 'alpha beta');
const second = fakeFile('b.md', 'gamma');
await expect(callTool(appWithFiles([first, second]), 'search_vault', { query: 'beta', deep: true })).resolves.toEqual({ content: [{ type: 'text', text: 'a.md\nalpha beta' }] });
});

test('list_vault_files filters folders non-recursively', async () => {
const first = fakeFile('folder/a.md', 'a');
const second = fakeFile('folder/deep/b.md', 'b');
await expect(callTool(appWithFiles([first, second]), 'list_vault_files', { folder: 'folder', recursive: false })).resolves.toEqual({ content: [{ type: 'text', text: 'folder/a.md' }] });
});

test('create_note creates a new note', async () => {
await expect(callTool(appWithFiles([]), 'create_note', { path: 'new.md', content: 'new' })).resolves.toEqual({ content: [{ type: 'text', text: 'Created new.md' }] });
});

test('append_note appends content', async () => {
const file = fakeFile('append.md', 'one');
await expect(callTool(appWithFiles([file]), 'append_note', { path: 'append.md', content: ' two' })).resolves.toEqual({ content: [{ type: 'text', text: 'Appended to append.md' }] });
expect(file.content).toBe('one two');
});

test('delete_note trashes a note', async () => {
const file = fakeFile('delete.md', 'bye');
await expect(callTool(appWithFiles([file]), 'delete_note', { path: 'delete.md' })).resolves.toEqual({ content: [{ type: 'text', text: 'Moved delete.md to trash' }] });
});
});
