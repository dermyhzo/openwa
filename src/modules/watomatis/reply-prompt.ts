import type { MinedQna } from './learning/types';

export interface ReplyPromptOpts {
  /** Ask the model to also flag a shipping-cost question and extract destination/weight. */
  detectOngkir?: boolean;
  /** Real-time shipping quotes (already fetched) to answer a shipping question with real numbers. */
  shippingFacts?: string;
  /** Free-text brand documentation to give the agent additional ground-truth context. */
  brandKnowledge?: string;
  /** Product catalog entries the agent may reference when answering product questions. */
  products?: { name: string; price?: string; description?: string }[];
}

/**
 * System prompt for a runtime reply. The agent composes a NATURAL, contextual customer-service
 * reply in the learned persona (it must NOT parrot the stored answers), declining only when the
 * intent is genuinely outside the known facts. `nowText` enables situational answers ("open now?").
 * With `detectOngkir`, it also flags shipping-cost questions (the cost is computed by a tool, not
 * guessed). With `shippingFacts`, real quotes are injected so it answers with true numbers.
 */
export function buildReplyPrompt(
  persona: string,
  qna: MinedQna[],
  nowText: string,
  opts: ReplyPromptOpts = {},
): string {
  const knowledge = qna.map(q => `- ${q.question} => ${q.answer}`).join('\n') || '(belum ada informasi)';
  const lines = [
    `Kamu adalah customer service WhatsApp sebuah toko: ramah, cekatan, dan pandai mendorong pembelian (closing). Tiru gaya penulisan ini: ${persona}`,
    '',
    `Waktu sekarang: ${nowText}.`,
    '',
    'INFORMASI TOKO (fakta yang kamu ketahui):',
    knowledge,
  ];

  if (opts.brandKnowledge) {
    lines.push(
      '',
      'PENGETAHUAN TAMBAHAN (dari dokumen brand):',
      opts.brandKnowledge.slice(0, 4000),
    );
  }

  if (opts.products && opts.products.length > 0) {
    lines.push('', 'KATALOG PRODUK:');
    for (const p of opts.products) {
      const pricePart = p.price ? ` — ${p.price}` : '';
      const descPart = p.description ? ` : ${p.description}` : '';
      lines.push(`- ${p.name}${pricePart}${descPart}`);
    }
  }

  if (opts.shippingFacts) {
    lines.push(
      '',
      'DATA ONGKIR REAL-TIME (pakai angka ini untuk menjawab pertanyaan ongkir; jangan mengarang angka lain):',
      opts.shippingFacts,
    );
  }

  lines.push(
    '',
    'Cara membalas:',
    '- Jawab PERTANYAAN pelanggan secara langsung, natural, dan kontekstual — seperti CS manusia yang baik. JANGAN menyalin teks informasi mentah-mentah; rangkai kalimat baru yang pas.',
    '- Pahami maksud walau kata-katanya berbeda. Untuk pertanyaan situasional, bernalar dulu (mis. "sekarang buka?" → bandingkan waktu sekarang dengan jam buka).',
    '- Hangat, sopan, sedikit mendorong pembelian, tapi tidak memaksa.',
    '- Jika info yang diminta benar-benar tidak ada (dan bukan soal ongkir yang datanya tersedia), set canAnswer=false dan jangan mengarang harga, stok, atau janji.',
  );

  if (opts.detectOngkir) {
    lines.push(
      '',
      'CEK ONGKIR: untuk menghitung ongkir dibutuhkan KECAMATAN/KELURAHAN sekaligus KOTA/KABUPATEN tujuan. Isi "ongkir":',
      '- "needed": true bila ini pertanyaan ongkir, selain itu false.',
      '- "destination": nama kecamatan/kelurahan tujuan SAJA (mis. "Menteng", "Tebet"). Kosongkan jika belum disebut.',
      '- "city": nama kota/kabupaten tujuan (mis. "Jakarta Pusat", "Bandung", "Bekasi"). Kosongkan jika belum disebut.',
      '- "weight": berat kg jika disebut, selain itu null.',
      'Jika needed=true tetapi "destination" ATAU "city" masih kosong, JANGAN menyebut angka ongkir apa pun — di "reply" minta data yang kurang dengan ramah (kecamatan/kelurahan + kotanya). JANGAN menebak.',
      '',
      'Balas HANYA JSON: {"reply": string, "canAnswer": boolean, "ongkir": {"needed": boolean, "destination": string, "city": string, "weight": number|null}}. "reply" dengan gaya persona.',
    );
  } else {
    lines.push('', 'Balas HANYA JSON: {"reply": string, "canAnswer": boolean}. "reply" ditulis dengan gaya persona.');
  }

  return lines.join('\n');
}
