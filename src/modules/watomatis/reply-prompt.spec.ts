import { buildReplyPrompt } from './reply-prompt';

describe('buildReplyPrompt', () => {
  it('embeds persona, knowledge, and the match-by-meaning instruction', () => {
    const p = buildReplyPrompt('Ramah dan santai', [
      { question: 'Jam buka?', answer: 'Buka 08.00-21.00 WIB' },
    ]);
    expect(p).toContain('Ramah dan santai');
    expect(p).toContain('Buka 08.00-21.00 WIB');
    expect(p).toContain('MAKNA');
    expect(p).toContain('canAnswer');
  });

  it('falls back to a placeholder when there is no Q&A', () => {
    expect(buildReplyPrompt('x', [])).toContain('belum ada informasi');
  });
});
