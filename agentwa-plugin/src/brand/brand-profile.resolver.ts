import { BrandProfile, BrandProfilePort } from '../core/ports';

/**
 * Resolves sessionId -> BrandProfile. One WhatsApp session/number == one brand.
 * MVP source is config: a per-session map with a default fallback. (Slice 2: storage override
 * + dashboard editor.)
 */
export class BrandProfileResolver implements BrandProfilePort {
  constructor(
    private readonly defaultProfile: BrandProfile,
    private readonly bySession: Record<string, BrandProfile>,
  ) {}

  resolve(sessionId: string): BrandProfile {
    return this.bySession[sessionId] ?? this.defaultProfile;
  }
}
