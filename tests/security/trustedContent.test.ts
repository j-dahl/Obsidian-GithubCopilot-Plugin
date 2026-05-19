import type { TFile } from 'obsidian';
import { Buffer } from 'node:buffer';
import { TRUSTED_CONTENT_MAX_CHARS, wrapForLlm } from '../../src/security/trustedContent';

function file(path: string, frontmatter?: Record<string, unknown>): TFile {
  return { path, frontmatter } as TFile & { frontmatter?: Record<string, unknown> };
}

const settings = { trustedFolders: ['Trusted', 'Templates/Nested'], trustedFrontmatterKey: 'agent-trusted' };

describe('trustedContent', () => {
  test('leaves null source as-is', () => {
    expect(wrapForLlm('hello', null, settings)).toBe('hello');
  });

  test('leaves trusted folder content unwrapped', () => {
    expect(wrapForLlm('hello', file('Trusted/note.md'), settings)).toBe('hello');
  });

  test('leaves trusted frontmatter content unwrapped', () => {
    expect(wrapForLlm('hello', file('Other/note.md', { 'agent-trusted': true }), settings)).toBe('hello');
  });

  test('wraps untrusted content with escaped source', () => {
    expect(wrapForLlm('hello', file('Bad/"x".md'), settings)).toBe('<untrusted source="Bad/&quot;x&quot;.md" encoding="base64">aGVsbG8=</untrusted>');
  });

  test('truncates content at 50K with notice', () => {
    const wrapped = wrapForLlm('a'.repeat(TRUSTED_CONTENT_MAX_CHARS + 10), file('Bad/note.md'), settings);
    const encoded = wrapped.match(/base64">([^<]+)/)?.[1] ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toContain('[Content truncated at 50,000 characters]');
  });

  test('literal closing untrusted marker round-trips inside base64', () => {
    const content = 'before </untrusted> after';
    const wrapped = wrapForLlm(content, file('Bad/note.md'), settings);
    expect(wrapped).not.toContain(content);
    const encoded = wrapped.match(/base64">([^<]+)/)?.[1] ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(content);
  });
});
