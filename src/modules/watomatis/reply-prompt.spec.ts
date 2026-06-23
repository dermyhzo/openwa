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

  it('injects brandKnowledge under the correct heading', () => {
    const p = buildReplyPrompt('x', [], 'Rabu, 10.00', { brandKnowledge: 'Brand kami berdiri sejak 2010.' });
    expect(p).toContain('PENGETAHUAN TAMBAHAN (dari dokumen brand):');
    expect(p).toContain('Brand kami berdiri sejak 2010.');
  });

  it('truncates brandKnowledge to 4000 chars', () => {
    const long = 'A'.repeat(5000);
    const p = buildReplyPrompt('x', [], 'Rabu, 10.00', { brandKnowledge: long });
    expect(p).toContain('A'.repeat(4000));
    expect(p).not.toContain('A'.repeat(4001));
  });

  it('injects products under KATALOG PRODUK with price and description', () => {
    const p = buildReplyPrompt('x', [], 'Kamis, 11.00', {
      products: [
        { name: 'Baju Batik', price: 'Rp150.000', description: 'Motif parang halus' },
        { name: 'Celana Formal' },
      ],
    });
    expect(p).toContain('KATALOG PRODUK:');
    expect(p).toContain('- Baju Batik — Rp150.000 : Motif parang halus');
    expect(p).toContain('- Celana Formal');
  });

  it('omits KATALOG PRODUK when products is empty', () => {
    const p = buildReplyPrompt('x', [], 'Jumat, 08.00', { products: [] });
    expect(p).not.toContain('KATALOG PRODUK:');
  });

  it('omits brandKnowledge section when not provided', () => {
    const p = buildReplyPrompt('x', [], 'Jumat, 08.00');
    expect(p).not.toContain('PENGETAHUAN TAMBAHAN');
  });
});
