import { TranscriptTurn } from '../ingestion/types';
import { ChatLlm } from './llm-chat';
import { VoiceCard, MinedQna } from './types';

/** Build an editable Voice Card (writing-style profile) from the owner's own messages. */
export async function extractVoiceCard(turns: TranscriptTurn[], llm: ChatLlm): Promise<VoiceCard> {
  const mine = turns.filter(t => t.sender === 'me').map(t => t.text);
  const avgReplyChars = Math.round(mine.reduce((s, x) => s + x.length, 0) / (mine.length || 1));
  const sample = mine.slice(0, 150).join('\n');
  const sys =
    'Kamu analis gaya komunikasi. Semua pesan berikut ditulis oleh SATU orang (seorang CS). ' +
    'Ekstrak "Voice Card" gaya tulisnya. Balas HANYA JSON dengan bentuk: ' +
    '{"tone":string,"formality":"formal|semi|casual","emojiUsage":string,"greetings":string[],"closings":string[],"quirks":string[],"summary":string}. ' +
    'summary = 1 paragraf persona singkat untuk menyuruh AI meniru gaya ini. Gunakan Bahasa Indonesia.';
  const res = await llm.json(sys, `Pesan:\n${sample}`);
  return {
    tone: String(res.tone ?? ''),
    formality: (res.formality as VoiceCard['formality']) ?? 'casual',
    emojiUsage: String(res.emojiUsage ?? ''),
    greetings: Array.isArray(res.greetings) ? (res.greetings as string[]) : [],
    closings: Array.isArray(res.closings) ? (res.closings as string[]) : [],
    quirks: Array.isArray(res.quirks) ? (res.quirks as string[]) : [],
    summary: String(res.summary ?? ''),
    avgReplyChars,
  };
}

/** Collect customer->CS reply pairs, then ask the LLM to clean them into reusable Q&A. */
export async function mineQna(turns: TranscriptTurn[], llm: ChatLlm): Promise<MinedQna[]> {
  const pairs: { q: string; a: string }[] = [];
  for (let i = 0; i < turns.length - 1; i++) {
    if (turns[i].sender === 'them' && turns[i + 1].sender === 'me') {
      pairs.push({ q: turns[i].text, a: turns[i + 1].text });
    }
  }
  if (pairs.length === 0) return [];
  const sys =
    'Dari pasangan (pertanyaan pelanggan -> jawaban CS) berikut, rapikan jadi daftar Q&A yang bisa dipakai ulang. ' +
    'Buang yang basa-basi/tidak informatif, gabungkan yang mirip, jadikan jawaban umum yang sopan. ' +
    'Balas HANYA JSON: {"qna":[{"question":string,"answer":string}]}. Gunakan Bahasa Indonesia.';
  const res = await llm.json(sys, JSON.stringify(pairs).slice(0, 6000));
  const qna = res.qna;
  return Array.isArray(qna) ? (qna as MinedQna[]) : [];
}
