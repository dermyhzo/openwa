import { buildSystemPrompt } from './prompt';
import { BrandProfile } from './ports';

const profile: BrandProfile = {
  name: 'Toko Kopi', systemPersona: 'Ramah dan singkat.', businessProfile: 'Jual kopi.',
  faq: 'Q: Ongkir? A: Gratis di atas 100rb.', fallbackMessage: 'fb',
};

describe('buildSystemPrompt', () => {
  it('embeds persona, business profile, knowledge, and demands JSON output', () => {
    const p = buildSystemPrompt(profile, profile.faq, 'id');
    expect(p).toContain('Toko Kopi');
    expect(p).toContain('Jual kopi.');
    expect(p).toContain('Gratis di atas 100rb');
    expect(p).toContain('canAnswer');
  });
});
