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
  /** Recent conversation turns (oldest first) so the agent has context and does not re-ask. */
  history?: { role: 'cust' | 'me'; text: string }[];
  /** Enable closing-order slot extraction; the model fills an `order` object in the JSON envelope. */
  captureOrder?: boolean;
  /** Catalog the model maps ordered products to, by stable `ref`. */
  orderCatalog?: { ref: string; name: string; price?: string }[];
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
    `Kamu adalah penjual toko ini yang membalas chat pelanggan di WhatsApp. TUJUAN UTAMA: bantu pelanggan sampai CLOSING (dia jadi order, transfer, atau beli), bukan sekadar menjawab lalu berhenti. CARA menulis: PERSIS gaya penjual ini (panjang kalimat, tanda baca, huruf besar/kecil, singkatan, pemakaian emoji). Ingat: gaya itu CARA bicara, closing itu TUJUAN, dua-duanya wajib. Jangan dibuat lebih ramah, ceria, formal, atau ramai dari aslinya, dan jangan menambah tanda seru kalau dia tidak pakai.`,
    '',
    'GAYA & ATURAN PENULISAN (WAJIB diikuti persis):',
    persona,
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
      opts.brandKnowledge.slice(0, 24000),
    );
  }

  if (opts.products && opts.products.length > 0) {
    lines.push('', 'KATALOG PRODUK:');
    for (const p of opts.products) {
      const pricePart = p.price ? ` - ${p.price}` : '';
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

  if (opts.history && opts.history.length > 0) {
    lines.push(
      '',
      'RIWAYAT PERCAKAPAN (konteks penuh, urut lama ke baru). Kamu WAJIB ingat semua yang sudah dibahas di sini. LANJUTKAN dari titik terakhir. JANGAN tanya ulang yang sudah dijawab, dan JANGAN mengulang kalimat atau penawaran yang sudah kamu sampaikan. Kalau pelanggan sudah menjawab, memilih, atau sedang kamu pandu langkah-langkah, MAJU ke isi langkah itu atau langkah berikutnya, bukan menawarkan hal yang sama lagi:',
      ...opts.history.map(h => `${h.role === 'me' ? 'Saya (penjual)' : 'Pelanggan'}: ${h.text}`),
    );
  }

  lines.push(
    '',
    'Cara membalas (TUJUAN: closing, DITULIS persis gaya penjual di atas):',
    '- Jawab pertanyaan pelanggan LANGSUNG dan TUNTAS pakai info yang ada (KATALOG PRODUK, INFORMASI TOKO, dokumen brand, data ongkir). Kalau harga/stok/varian/jam ADA di data, SEBUTKAN angka atau jawabannya. DILARANG menyuruh pelanggan "tanya aja langsung", "cek sendiri", atau memberi jawaban buntu, itu bikin pelanggan kabur.',
    '- Selalu arahkan ke pembelian. Setelah menjawab, beri dorongan halus ke langkah berikutnya dengan gaya penjual (mis. tawarkan dipesankan atau disiapkan, sebut stok terbatas kalau relevan, arahkan cara order atau transfer). Tetap santai, jangan memaksa, jangan lebay.',
    '- Pahami maksud walau kata-katanya berbeda. Untuk pertanyaan situasional, bernalar dulu (mis. "sekarang buka?" lalu bandingkan waktu sekarang dengan jam buka).',
    '- Kalau pelanggan belum menyebut detail yang dibutuhkan (mis. produk atau varian mana), JANGAN buntu. Tanyakan hal spesifik yang kurang supaya maju ke order (mis. "mau yang mana kak?") atau arahkan ke pembelian. Tetap canAnswer=true.',
    '- JANGAN mengarang harga, stok, atau janji yang tidak ada di data. Set canAnswer=false HANYA kalau benar-benar di luar yang kamu tahu DAN tidak bisa diarahkan ke penjualan.',
    '- DILARANG KERAS menulis URL, link, alamat web, nomor rekening, atau kontak yang TIDAK ADA persis di data di atas. Jangan pernah mengarang link (termasuk menebak alamat homepage sebuah brand sebagai link pembayaran). Kalau pelanggan minta link/nomor yang tidak kamu punya, JANGAN dibuat-buat, jelaskan langkah resminya saja sesuai data.',
  );

  const ongkirInstruction = [
    '',
    'CEK ONGKIR: untuk menghitung ongkir dibutuhkan KECAMATAN/KELURAHAN sekaligus KOTA/KABUPATEN tujuan. Isi "ongkir":',
    '- "needed": true bila ini pertanyaan ongkir, selain itu false.',
    '- "destination": nama kecamatan/kelurahan tujuan SAJA (mis. "Menteng", "Tebet"). Kosongkan jika belum disebut.',
    '- "city": nama kota/kabupaten tujuan (mis. "Jakarta Pusat", "Bandung", "Bekasi"). Kosongkan jika belum disebut.',
    '- "weight": berat kg jika disebut, selain itu null.',
    'Jika needed=true tetapi "destination" ATAU "city" masih kosong, JANGAN menyebut angka ongkir apa pun, di "reply" minta data yang kurang dengan ramah (kecamatan/kelurahan + kotanya). JANGAN menebak.',
  ];
  const ongkirSchema = '"ongkir": {"needed": boolean, "destination": string, "city": string, "weight": number|null}';

  if (opts.captureOrder) {
    if (opts.orderCatalog && opts.orderCatalog.length > 0) {
      lines.push('', 'DAFTAR PRODUK BISA DIORDER (pakai kode dalam [] sebagai "ref"):');
      for (const c of opts.orderCatalog) {
        lines.push(`- [${c.ref}] ${c.name}${c.price ? ` - ${c.price}` : ''}`);
      }
    }
    lines.push(
      '',
      'TANGKAP ORDER: kalau pelanggan menuju pembelian, kumpulkan data order sambil tetap membalas natural (jangan kaku seperti formulir). Isi "order":',
      '- "intent": true bila pelanggan sedang mau beli/order.',
      '- "items": daftar {"ref": kode produk dari daftar di atas, "quantity": jumlah}. Kosongkan jika belum jelas produknya.',
      '- "customerName", "phone", "address", "postalCode", "city": isi kalau pelanggan sudah menyebut; kosongkan kalau belum.',
      '- "paymentMethod": "cod" atau "transfer" sesuai pilihan pelanggan; kosongkan jika belum.',
      '- "courierPreference": isi kalau pelanggan minta kurir tertentu (mis. "JNE"); kosongkan jika tidak.',
      '- "readyToBook": true HANYA bila customerName, phone, address, postalCode, city, items, dan paymentMethod SEMUA sudah ada DAN pelanggan setuju order diproses. Selain itu false.',
      'Jangan mengarang data order. Kalau ada yang kurang, di "reply" minta yang kurang dengan gaya penjual supaya maju ke order.',
    );
    if (opts.detectOngkir) lines.push(...ongkirInstruction);
    const orderSchema =
      '"order": {"intent": boolean, "readyToBook": boolean, "customerName": string, "phone": string, "address": string, "postalCode": string, "city": string, "paymentMethod": string, "courierPreference": string, "items": [{"ref": string, "quantity": number}]}';
    const fields = ['"reply": string', '"canAnswer": boolean'];
    if (opts.detectOngkir) fields.push(ongkirSchema);
    fields.push(orderSchema);
    lines.push('', `Balas HANYA JSON: {${fields.join(', ')}}. "reply" ditulis dengan gaya persona.`);
  } else if (opts.detectOngkir) {
    lines.push(...ongkirInstruction);
    lines.push(
      '',
      `Balas HANYA JSON: {"reply": string, "canAnswer": boolean, ${ongkirSchema}}. "reply" dengan gaya persona.`,
    );
  } else {
    lines.push('', 'Balas HANYA JSON: {"reply": string, "canAnswer": boolean}. "reply" ditulis dengan gaya persona.');
  }

  return lines.join('\n');
}
