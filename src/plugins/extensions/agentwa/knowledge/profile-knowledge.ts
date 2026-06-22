import { BrandProfile, KnowledgePort } from '../core/ports';

/**
 * MVP knowledge: returns the brand's whole FAQ verbatim (no retrieval/embeddings yet).
 * The CachePort/semantic retrieval arrives in Slice 2 / Phase 2.
 */
export class ProfileKnowledge implements KnowledgePort {
  retrieve(profile: BrandProfile, _query: string): string {
    return profile.faq;
  }
}
