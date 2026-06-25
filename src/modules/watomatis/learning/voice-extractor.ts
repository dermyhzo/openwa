import { TranscriptTurn } from '../ingestion/types';
import { ChatLlm } from './llm-chat';
import { VoiceCard, MinedQna } from './types';

const EMOJI = /\p{Extended_Pictographic}/u;

/** Deterministic style signals straight from the owner's real messages (not an LLM paraphrase). */
function styleSignals(messages: string[]) {
  // Drop media blobs, links, and over-long lines that are not representative texting.
  const clean = messages.filter(
    m => m && m.trim().length > 0 && m.length <= 140 && !/^\/9j\/|^data:|^https?:\/\//.test(m) && m !== 'System notification',
  );
  const n = clean.length || 1;
  const rate = (re: RegExp) => clean.filter(m => re.test(m)).length / n;
  const exclamationRate = rate(/!/);
  const emojiRate = clean.filter(m => EMOJI.test(m)).length / n;
  const avgWords = Math.round(clean.reduce((s, m) => s + m.trim().split(/\s+/).length, 0) / n);
  // A spread of short, representative real messages for few-shot mimicry.
  const samples = clean.filter(m => m.split(/\s+/).length >= 2).slice(0, 8);
  return { count: clean.length, exclamationRate, emojiRate, avgWords, samples };
}

/** Hard, data-derived rules the agent must follow to actually sound like this person. */
function styleRules(s: ReturnType<typeof styleSignals>, formality: VoiceCard['formality']): string[] {
  const rules: string[] = [];
  if (s.exclamationRate === 0) rules.push('TIDAK PERNAH memakai tanda seru. Dilarang menulis karakter "!" sama sekali.');
  else if (s.exclamationRate < 0.15) rules.push('Hampir tidak pernah memakai tanda seru, jadi hindari "!".');
  if (s.emojiRate === 0) rules.push('Tidak memakai emoji.');
  else if (s.emojiRate < 0.25) rules.push('Sangat jarang memakai emoji (sesekali saja, jangan di tiap pesan).');
  if (s.avgWords > 0 && s.avgWords <= 6) rules.push('Membalas pendek dan ringkas, biasanya beberapa kata saja, tidak bertele-tele.');
  if (formality === 'casual') rules.push('Santai dan informal, sering menyingkat kata (mis. yg, bgt, gk, td, aja, dll) seperti pada contoh.');
  rules.push('Jangan menambah keceriaan, sapaan, atau gaya yang tidak ada di contoh. Kalau ragu, tiru contoh.');
  return rules;
}

/** Build an editable Voice Card (writing-style profile) from the owner's own messages. */
export async function extractVoiceCard(turns: TranscriptTurn[], llm: ChatLlm): Promise<VoiceCard> {
  const mine = turns.filter(t => t.sender === 'me').map(t => t.text);
  const avgReplyChars = Math.round(mine.reduce((s, x) => s + x.length, 0) / (mine.length || 1));
  const sig = styleSignals(mine);
  const sample = mine.slice(0, 150).join('\n');
  const sys =
    'Kamu analis gaya komunikasi. Semua pesan berikut ditulis oleh SATU orang (penjual). ' +
    'Ekstrak "Voice Card" gaya tulisnya APA ADANYA (jangan dibuat lebih ramah/ceria/formal dari aslinya). ' +
    'Balas HANYA JSON dengan bentuk: ' +
    '{"tone":string,"formality":"formal|semi|casual","emojiUsage":string,"greetings":string[],"closings":string[],"quirks":string[],"summary":string}. ' +
    'summary = 1 paragraf persona singkat yang mendeskripsikan gaya ini apa adanya. Gunakan Bahasa Indonesia.';
  const res = await llm.json(sys, `Pesan:\n${sample}`);
  const formality = (res.formality as VoiceCard['formality']) ?? 'casual';

  // Compose a summary that the reply prompt can mimic faithfully: persona + hard rules + real examples.
  const rules = styleRules(sig, formality);
  const summary = [
    String(res.summary ?? ''),
    rules.length ? 'ATURAN GAYA WAJIB:\n' + rules.map(r => `- ${r}`).join('\n') : '',
    sig.samples.length
      ? 'CONTOH pesan asli penjual (tiru gaya, nada, panjang, tanda baca, singkatan, dan emoji-nya; JANGAN tiru isinya):\n' +
        sig.samples.map(m => `- ${m}`).join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    tone: String(res.tone ?? ''),
    formality,
    emojiUsage: String(res.emojiUsage ?? ''),
    greetings: Array.isArray(res.greetings) ? (res.greetings as string[]) : [],
    closings: Array.isArray(res.closings) ? (res.closings as string[]) : [],
    quirks: Array.isArray(res.quirks) ? (res.quirks as string[]) : [],
    summary,
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
