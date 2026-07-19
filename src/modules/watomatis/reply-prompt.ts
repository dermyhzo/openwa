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
  /** What the agent drives the customer toward. Shapes the mission + how hard it pushes a sale. Default 'closing'. */
  goal?: 'closing' | 'service' | 'full_auto';
  /**
   * Result of verifying a "sudah bayar" claim against the payment system (Scalev).
   * 'verified' = a real paid order exists -> after-sales allowed; 'unverified' = customer claims paid
   * but no paid order found -> DENY access, ask them to complete/confirm; 'unknown' = no claim / not checked.
   */
  paymentStatus?: 'verified' | 'unverified' | 'unknown';
  /** Enable closing-order slot extraction; the model fills an `order` object in the JSON envelope. */
  captureOrder?: boolean;
  /** Catalog the model maps ordered products to, by stable `ref`. `isDigital` routes fulfilment: payment link vs shipped order. */
  orderCatalog?: { ref: string; name: string; price?: string; isDigital?: boolean }[];
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

  // The GOAL shapes the mission and how hard the agent pushes a sale. The learned style is always kept.
  const goal = opts.goal ?? 'closing';
  const styleClause =
    'CARA menulis: PERSIS gaya penjual ini (panjang kalimat, tanda baca, huruf besar/kecil, singkatan, pemakaian emoji). Jangan dibuat lebih ramah, ceria, formal, atau ramai dari aslinya, dan jangan menambah tanda seru kalau dia tidak pakai.';
  let mission: string;
  let replyHeader: string;
  let driveLine: string;
  if (goal === 'service') {
    mission =
      'Kamu CS toko ini yang membalas chat pelanggan di WhatsApp. TUJUAN UTAMA: LAYANI pelanggan sampai TUNTAS dan puas, jawab semua pertanyaannya dengan jelas dan ramah. Boleh sebut produk atau harga kalau relevan, tapi JANGAN memaksa jualan atau hard-selling. ' +
      styleClause;
    replyHeader = 'Cara membalas (TUJUAN: layani pelanggan sampai tuntas, DITULIS persis gaya penjual di atas):';
    driveLine =
      '- Fokus membantu dan menjawab sampai pelanggan jelas dan puas. Boleh arahkan ke pembelian dengan halus kalau memang relevan, tapi JANGAN memaksa. Utamakan pengalaman pelanggan.';
  } else if (goal === 'full_auto') {
    mission =
      'Kamu CS toko ini yang membalas chat pelanggan di WhatsApp. TUJUAN UTAMA BERTAHAP: (1) pertama, kejar CLOSING, dorong pelanggan terus sampai dia benar-benar bayar. (2) Pindah ke AFTER-SALES HANYA kalau STATUS PEMBAYARAN dari sistem = TERVERIFIKASI. Kalau sudah terverifikasi: BERHENTI menjual, pandu cara pakai dari langkah paling awal sampai pelanggan tuntas. ATURAN KERAS: JANGAN pernah percaya pelanggan yang cuma bilang "sudah bayar" tanpa STATUS PEMBAYARAN = terverifikasi. Klaim sepihak TIDAK memberi hak akses, panduan setup, atau link apa pun, karena pembayaran hanya sah kalau tercatat di sistem. ' +
      styleClause;
    replyHeader = 'Cara membalas (TUJUAN bertahap: closing dulu, after-sales HANYA setelah bayar terverifikasi; DITULIS persis gaya penjual di atas):';
    driveLine =
      '- Kalau pelanggan BELUM bayar, ATAU ngaku sudah bayar tapi STATUS PEMBAYARAN belum "verified": TERUS arahkan menyelesaikan pembayaran di link resmi. DILARANG kasih akses, panduan setup/install, atau link download. Kalau dia ngotot sudah bayar, minta baik-baik nomor HP/email yang dipakai saat checkout supaya dicek, jangan menuduh tapi jangan juga langsung percaya. Kalau STATUS PEMBAYARAN = "verified": BERHENTI jualan, layani after-sales, pandu pemakaian MULAI DARI LANGKAH PALING AWAL (persiapan/pasang/setup), URUT dari langkah pertama, DILARANG lompat ke langkah tengah atau ke fitur yang tadi dijual. Pastikan tiap pertanyaannya terjawab sampai tuntas.';
  } else {
    mission =
      'Kamu adalah penjual toko ini yang membalas chat pelanggan di WhatsApp. TUJUAN UTAMA: bantu pelanggan sampai CLOSING (dia jadi order, transfer, atau beli), bukan sekadar menjawab lalu berhenti. Ingat: gaya itu CARA bicara, closing itu TUJUAN, dua-duanya wajib. ' +
      styleClause;
    replyHeader = 'Cara membalas (TUJUAN: closing, DITULIS persis gaya penjual di atas):';
    driveLine =
      '- Selalu arahkan ke pembelian. Setelah menjawab, beri dorongan halus ke langkah berikutnya dengan gaya penjual (mis. tawarkan dipesankan atau disiapkan, sebut stok terbatas kalau relevan, arahkan cara order atau transfer). Tetap santai, jangan memaksa, jangan lebay.';
  }

  const lines = [
    mission,
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

  if (opts.paymentStatus === 'verified') {
    lines.push(
      '',
      'STATUS PEMBAYARAN (dari sistem, prioritas TERTINGGI, WAJIB dipatuhi): TERVERIFIKASI. Sistem SUDAH memastikan pembayaran pelanggan ini lunas, jadi kamu TIDAK perlu dan DILARANG bilang "saya cek dulu", "sebentar dicek", atau menunda apa pun. Berhenti menjual. LANGSUNG: ucapkan terima kasih singkat, lalu berikan LANGKAH PERTAMA setup secara konkret dan urut (yang PALING awal dulu: pasang/install), jangan lompat ke langkah tengah.',
    );
  } else if (opts.paymentStatus === 'unverified') {
    lines.push(
      '',
      'STATUS PEMBAYARAN (dari sistem, prioritas TERTINGGI, WAJIB dipatuhi): BELUM TERVERIFIKASI. Pelanggan MENGAKU sudah bayar TAPI sistem TIDAK menemukan pembayaran lunas atas namanya. DILARANG KERAS memberi akses, link download, kredensial, atau panduan setup/install. Balas sopan: pembayaran belum terlihat masuk, arahkan selesaikan pembayaran di link resmi, dan minta nomor HP/email yang dipakai saat checkout untuk dicek ulang. Jangan menuduh, tapi JANGAN beri akses hanya karena dia bilang sudah bayar.',
    );
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
    replyHeader,
    '- Jawab pertanyaan pelanggan LANGSUNG dan TUNTAS pakai info yang ada (KATALOG PRODUK, INFORMASI TOKO, dokumen brand, data ongkir). Kalau harga/stok/varian/jam ADA di data, SEBUTKAN angka atau jawabannya. DILARANG menyuruh pelanggan "tanya aja langsung", "cek sendiri", atau memberi jawaban buntu, itu bikin pelanggan kabur.',
    driveLine,
    '- Pahami maksud walau kata-katanya berbeda. Untuk pertanyaan situasional, bernalar dulu (mis. "sekarang buka?" lalu bandingkan waktu sekarang dengan jam buka).',
    '- Kalau pelanggan belum menyebut detail yang dibutuhkan (mis. produk atau varian mana), JANGAN buntu. Tanyakan hal spesifik yang kurang supaya maju ke order (mis. "mau yang mana kak?") atau arahkan ke pembelian. Tetap canAnswer=true.',
    '- JANGAN mengarang harga, paket, tier, stok, cara bayar, atau nama metode/gateway pembayaran yang TIDAK ADA persis di data. Untuk harga, paket, dan cara bayar, pakai HANYA yang tertulis di KATALOG PRODUK, INFORMASI TOKO, atau dokumen di atas, jangan menambah pilihan/tier/metode yang tidak tercantum. Set canAnswer=false HANYA kalau benar-benar di luar yang kamu tahu DAN tidak bisa diarahkan ke penjualan.',
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
      lines.push('', 'DAFTAR PRODUK BISA DIORDER (pakai kode dalam [] sebagai "ref"). (D)=produk digital, (F)=barang fisik:');
      for (const c of opts.orderCatalog) {
        lines.push(`- [${c.ref}] ${c.isDigital ? '(D)' : '(F)'} ${c.name}${c.price ? ` - ${c.price}` : ''}`);
      }
    }
    lines.push(
      '',
      'ROUTING FULFILMENT (WAJIB, lihat tag produk): kalau yang diorder PRODUK DIGITAL (D), pelanggan cukup diarahkan ke LINK PEMBAYARAN/checkout resmi (linknya ada di dokumen brand di atas), JANGAN minta alamat, JANGAN hitung ongkir, JANGAN kumpulkan data pengiriman. Untuk produk digital cukup set order.intent=true dan items saja, biarkan alamat, kota, dan ongkir kosong. Kalau BARANG FISIK (F), baru kumpulkan alamat lengkap + data order dan ongkir dihitung. Jangan campur aturan ini.',
      'TANGKAP ORDER (khusus BARANG FISIK): kalau pelanggan menuju pembelian barang fisik, kumpulkan data order sambil tetap membalas natural (jangan kaku seperti formulir). Isi "order":',
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
