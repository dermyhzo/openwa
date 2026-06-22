import { BrandProfile } from './ports';

/**
 * Builds the system prompt. Forces grounding (answer only from KNOWLEDGE) and a strict
 * JSON envelope so the caller can confidence-gate on `canAnswer`.
 */
export function buildSystemPrompt(profile: BrandProfile, knowledge: string, language: string): string {
  return [
    `Kamu adalah "${profile.name}", asisten customer service WhatsApp. ${profile.systemPersona}`,
    `Balas dalam bahasa "${language}" (default Bahasa Indonesia), singkat, sopan, dan ramah.`,
    `Jawab HANYA berdasarkan KNOWLEDGE di bawah. Jika jawabannya tidak ada di KNOWLEDGE,`,
    `set "canAnswer" ke false dan JANGAN mengarang harga, stok, atau janji apa pun.`,
    `Keluarkan HANYA objek JSON: {"reply": string, "canAnswer": boolean}.`,
    ``,
    `PROFIL BISNIS:`,
    profile.businessProfile,
    ``,
    `KNOWLEDGE:`,
    knowledge,
  ].join('\n');
}
