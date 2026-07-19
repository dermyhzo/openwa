import { retrieveKnowledge } from './retriever';

const SAMPLE_KB = `## Harga
Harga Rp199.000 sekali bayar, tidak ada biaya bulanan tambahan. Ini adalah harga terbaik yang kami tawarkan untuk semua fitur lengkap termasuk setup dan support.

## Ongkir
Cek ongkir real-time lewat api.co.id sebelum konfirmasi pesanan. Kami mendukung semua kurir utama: JNE, J&T, SiCepat, Anteraja, dan Pos Indonesia. Estimasi pengiriman ke Bekasi biasanya 1-2 hari kerja.

## Keamanan
Self-hosted, data privat, terenkripsi end-to-end. Tidak ada data pelanggan yang keluar ke server kami. Enkripsi AES-256 untuk semua data tersimpan.`;

describe('retrieveKnowledge', () => {
  it('(a) query "harganya berapa" returns chunk containing "199.000"', () => {
    const result = retrieveKnowledge(SAMPLE_KB, 'harganya berapa');
    expect(result).toContain('199.000');
  });

  it('(b) query "cek ongkir ke bekasi" returns the Ongkir chunk', () => {
    const result = retrieveKnowledge(SAMPLE_KB, 'cek ongkir ke bekasi');
    expect(result).toContain('Ongkir');
    expect(result).toContain('api.co.id');
  });

  it('(c) result.length <= maxChars for a small maxChars (best chunk is always included)', () => {
    // A very small maxChars - the single best chunk may exceed it (spec: still include it)
    // Use a maxChars large enough that at least 1 chunk fits but not all
    const result = retrieveKnowledge(SAMPLE_KB, 'harga', { maxChars: 300 });
    // Only one chunk should be returned; verify length is reasonable
    expect(result.length).toBeLessThanOrEqual(
      SAMPLE_KB.split('\n\n').reduce((max, s) => Math.max(max, s.length), 0) + 50,
    );
    // Sanity: result must not be the full KB
    expect(result.length).toBeLessThan(SAMPLE_KB.length);
  });

  it('(d) empty brandKnowledge returns empty string', () => {
    expect(retrieveKnowledge('', 'harga')).toBe('');
    expect(retrieveKnowledge('   ', 'harga')).toBe('');
  });

  it('(e) KB shorter than maxChars is returned unchanged', () => {
    const short = '## Harga\nRp199.000';
    expect(retrieveKnowledge(short, 'harga', { maxChars: 5000 })).toBe(short);
  });

  it('fallback: pure-stopword query returns opening slice of KB', () => {
    // All tokens here are stopwords, so queryTokens will be empty after filtering
    const result = retrieveKnowledge(SAMPLE_KB, 'ya itu ini', { maxChars: 200 });
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toBe(SAMPLE_KB.slice(0, 200));
  });

  it('topK=1 returns only the single best-scoring chunk for a focused query', () => {
    // maxChars must be smaller than the full KB (544 chars) to bypass short-circuit,
    // but large enough to hold one section (~180 chars). 250 works.
    const result = retrieveKnowledge(SAMPLE_KB, 'enkripsi terenkripsi privat', {
      topK: 1,
      maxChars: 250,
    });
    expect(result).toContain('Keamanan');
    const headingMatches = (result.match(/^## /gm) ?? []).length;
    expect(headingMatches).toBeLessThanOrEqual(1);
  });
});
