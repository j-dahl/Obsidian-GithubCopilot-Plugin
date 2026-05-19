import { ANTI_INJECTION_CLAUSE, buildSystemPrompt } from '../../src/security/systemPrompt';

describe('systemPrompt', () => {
  test('always includes anti-injection clause', () => {
    expect(buildSystemPrompt({ preset: 'strict', tools: [] })).toContain(ANTI_INJECTION_CLAUSE);
  });

  test('renders tool list', () => {
    const prompt = buildSystemPrompt({
      preset: 'balanced',
      tools: [{ serverId: 'filesystem', name: 'read_file', description: 'Read a file' }],
    });
    expect(prompt).toContain('filesystem:read_file');
    expect(prompt).toContain('Read a file');
  });

  test('escapes current file and tool text', () => {
    const prompt = buildSystemPrompt({
      preset: 'trusted',
      currentFile: '<untrusted source="x">',
      tools: [{ serverId: '<server>', name: '<tool>', description: '<desc>' }],
    });
    expect(prompt).not.toContain('<untrusted source="x">');
    expect(prompt).toContain('&lt;untrusted source="x"&gt;');
    expect(prompt).toContain('&lt;server&gt;:&lt;tool&gt;');
  });
});