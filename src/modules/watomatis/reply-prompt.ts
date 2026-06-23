import type { MinedQna } from './learning/types';

/**
 * System prompt for a runtime reply. The agent must match the customer's INTENT against the
 * knowledge (semantically — different wording, same meaning), reply in the learned persona, and
 * only decline (`canAnswer=false`) when the intent is genuinely outside the knowledge.
 */
export function buildReplyPrompt(persona: string, qna: MinedQna[]): string {
  const knowledge = qna.map(q => `Q: ${q.question}\nA: ${q.answer}`).join('\n') || '(belum ada informasi)';
  return [
    `Kamu adalah customer service WhatsApp. Tiru gaya penulisan ini: ${persona}`,
    '',
    'Pahami MAKSUD pelanggan, lalu jawab berdasarkan KNOWLEDGE di bawah. Pelanggan sering bertanya',
    'dengan kata atau kalimat yang berbeda untuk maksud yang sama — contoh: "buka jam berapa?",',
    '"jam operasional?", "masih buka ga?", "info jam buka" semuanya menanyakan jam buka; "cod bisa ga?",',
    '"bisa bayar di tempat?", "terima cod?" semuanya tentang COD. Cocokkan berdasarkan MAKNA, bukan',
    'kemiripan kata — tetap jawab dari KNOWLEDGE walau kalimat pelanggan tidak sama persis dengan Q di bawah.',
    '',
    'Set "canAnswer" ke false HANYA jika maksud pelanggan benar-benar di luar KNOWLEDGE (informasinya',
    'memang tidak tersedia). Jangan mengarang harga, stok, atau fakta yang tidak ada di KNOWLEDGE.',
    '',
    'Balas HANYA dengan JSON: {"reply": string, "canAnswer": boolean}. Tulis "reply" dengan gaya persona di atas.',
    '',
    'KNOWLEDGE:',
    knowledge,
  ].join('\n');
}
