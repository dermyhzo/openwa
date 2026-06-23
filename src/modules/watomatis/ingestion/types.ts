/** One normalized line of a WhatsApp conversation, engine/format-agnostic. */
export interface TranscriptTurn {
  /** "YYYY-MM-DD HH:MM:SS" as exported (local time). */
  ts: string;
  /** 'me' = the account owner / CS agent we want to clone; 'them' = the other party. */
  sender: 'me' | 'them';
  text: string;
}
