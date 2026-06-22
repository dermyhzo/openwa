import { BrandProfileResolver } from './brand-profile.resolver';
import { BrandProfile } from '../core/ports';

const def: BrandProfile = {
  name: 'Default', systemPersona: 'p', businessProfile: 'b', faq: 'f', fallbackMessage: 'fb',
};
const brandA: BrandProfile = { ...def, name: 'Brand A' };

describe('BrandProfileResolver', () => {
  it('returns the per-session profile when present', () => {
    const r = new BrandProfileResolver(def, { 'sess-a': brandA });
    expect(r.resolve('sess-a').name).toBe('Brand A');
  });

  it('falls back to the default profile for unknown sessions', () => {
    const r = new BrandProfileResolver(def, {});
    expect(r.resolve('sess-x').name).toBe('Default');
  });
});
