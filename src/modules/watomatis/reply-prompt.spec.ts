import { buildReplyPrompt } from './reply-prompt';

describe('buildReplyPrompt', () => {
  it('embeds persona, store facts, current time, and asks for natural replies', () => {
    const p = buildReplyPrompt(
      'Ramah dan santai',
      [{ question: 'Jam buka?', answer: 'Buka 08.00-21.00 WIB' }],
      'Senin, 14.05',
    );
    expect(p).toContain('Ramah dan santai');
    expect(p).toContain('Buka 08.00-21.00 WIB');
    expect(p).toContain('Senin, 14.05');
    expect(p).toContain('INFORMASI TOKO');
    expect(p).toContain('JANGAN menyalin');
    expect(p).toContain('canAnswer');
  });

  it('falls back to a placeholder when there is no Q&A', () => {
    expect(buildReplyPrompt('x', [], 'Selasa, 09.00')).toContain('belum ada informasi');
  });
});
