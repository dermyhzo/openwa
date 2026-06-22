import { ProfileKnowledge } from './profile-knowledge';
import { BrandProfile } from '../core/ports';

const profile: BrandProfile = {
  name: 'Toko', systemPersona: 'p', businessProfile: 'b',
  faq: 'Q: Jam buka? A: 08-21.', fallbackMessage: 'fb',
};

describe('ProfileKnowledge', () => {
  it('returns the brand FAQ as the retrieved knowledge', () => {
    const k = new ProfileKnowledge();
    expect(k.retrieve(profile, 'jam buka?')).toContain('08-21');
  });
});
