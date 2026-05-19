import type { TFile } from 'obsidian';
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
    expect(wrapForLlm('hello', file('Bad/"x".md'), settings)).toBe('<untrusted source="Bad/&quot;x&quot;.md">\nhello\n</untrusted>');
  });

  test('truncates content at 50K with notice', () => {
    const wrapped = wrapForLlm('a'.repeat(TRUSTED_CONTENT_MAX_CHARS + 10), file('Bad/note.md'), settings);
    expect(wrapped).toContain('[Content truncated at 50,000 characters]');
    expect(wrapped.length).toBeLessThan(TRUSTED_CONTENT_MAX_CHARS + 200);
  });
});