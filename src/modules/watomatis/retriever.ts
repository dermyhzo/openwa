// BM25 lexical retrieval - returns only the relevant slices of brandKnowledge for a query.
// Zero dependencies, pure function, deterministic, no I/O.

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const MAX_SECTION_CHARS = 1200;
const DEFAULT_TOP_K = 6;
const DEFAULT_MAX_CHARS = 4000;

// ~40 common Indonesian + English stopwords
const STOPWORDS = new Set([
  'yang', 'di', 'ke', 'dari', 'dan', 'atau', 'ini', 'itu', 'untuk', 'dengan',
  'ada', 'aja', 'kak', 'kakak', 'saya', 'aku', 'kamu', 'anda', 'nggak', 'ga',
  'gak', 'ya', 'sih', 'dong', 'kalo', 'kalau', 'mau', 'bisa', 'apa', 'gimana',
  'the', 'a', 'an', 'to', 'of', 'is', 'it', 'in', 'on', 'for', 'and', 'or',
  'tidak', 'juga', 'sudah', 'bisa', 'akan', 'lebih', 'kita', 'kami', 'mereka',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

interface Chunk {
  text: string;
  tokens: string[];
}

function chunkKnowledge(kb: string): Chunk[] {
  const lines = kb.split('\n');
  const chunks: Chunk[] = [];

  let currentHeading = '';
  let currentBody: string[] = [];

  function flushSection(heading: string, body: string[]): void {
    const bodyText = body.join('\n').trim();
    const sectionText = heading ? `${heading}\n${bodyText}` : bodyText;
    if (!sectionText.trim()) return;

    if (sectionText.length <= MAX_SECTION_CHARS) {
      chunks.push({ text: sectionText, tokens: tokenize(sectionText) });
      return;
    }

    // Split long section on blank lines into sub-chunks, prefix each with heading
    const paragraphs = bodyText.split(/\n{2,}/);
    let acc: string[] = [];

    function flushAcc(): void {
      const raw = acc.join('\n\n').trim();
      if (!raw) return;
      const full = heading ? `${heading}\n${raw}` : raw;
      chunks.push({ text: full, tokens: tokenize(full) });
      acc = [];
    }

    for (const para of paragraphs) {
      const prospective = acc.length === 0 ? para : acc.join('\n\n') + '\n\n' + para;
      const prospectiveLen = (heading ? heading.length + 1 : 0) + prospective.length;
      if (prospectiveLen > MAX_SECTION_CHARS && acc.length > 0) {
        flushAcc();
      }
      acc.push(para);
    }
    flushAcc();
  }

  for (const line of lines) {
    if (/^#{2,3} /.test(line)) {
      flushSection(currentHeading, currentBody);
      currentHeading = line;
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  flushSection(currentHeading, currentBody);

  return chunks;
}

function bm25Score(
  queryTokens: string[],
  chunk: Chunk,
  idf: Map<string, number>,
  avgdl: number,
): number {
  const dl = chunk.tokens.length;
  // term frequency map for this chunk
  const tf = new Map<string, number>();
  for (const t of chunk.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  let score = 0;
  for (const qt of queryTokens) {
    const idfVal = idf.get(qt) ?? 0;
    if (idfVal === 0) continue;
    const f = tf.get(qt) ?? 0;
    const numerator = f * (BM25_K1 + 1);
    const denominator = f + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl));
    score += idfVal * (numerator / denominator);
  }
  return score;
}

export function retrieveKnowledge(
  brandKnowledge: string,
  query: string,
  opts?: { topK?: number; maxChars?: number },
): string {
  const topK = opts?.topK ?? DEFAULT_TOP_K;
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;

  if (!brandKnowledge || !brandKnowledge.trim()) return '';
  if (brandKnowledge.length <= maxChars) return brandKnowledge;

  const chunks = chunkKnowledge(brandKnowledge);
  if (chunks.length === 0) return '';

  const queryTokens = tokenize(query);

  // Fallback: no informative query tokens - return opening context
  if (queryTokens.length === 0) {
    return brandKnowledge.slice(0, maxChars);
  }

  const N = chunks.length;

  // Compute IDF: log((N - df + 0.5) / (df + 0.5) + 1)
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    const seen = new Set(chunk.tokens);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, freq] of df) {
    idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  }

  const avgdl = chunks.reduce((s, c) => s + c.tokens.length, 0) / N;

  // Score and rank
  const scored = chunks.map((chunk, i) => ({
    i,
    score: bm25Score(queryTokens, chunk, idf, avgdl),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Greedy fill up to maxChars / topK
  const selected: string[] = [];
  let totalChars = 0;

  for (const { i } of scored) {
    if (selected.length >= topK) break;
    const text = chunks[i].text;
    if (selected.length === 0) {
      // Always include the best chunk even if oversized
      selected.push(text);
      totalChars += text.length;
      continue;
    }
    const added = totalChars === 0 ? text.length : text.length + 2; // +2 for "\n\n"
    if (totalChars + added > maxChars) break;
    selected.push(text);
    totalChars += added;
  }

  return selected.join('\n\n');
}
