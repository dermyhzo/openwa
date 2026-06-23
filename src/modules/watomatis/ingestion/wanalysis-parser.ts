import { TranscriptTurn } from './types';

/**
 * Tokenize CSV text into rows of fields. Handles RFC-4180 double-quoted fields (so a delimiter,
 * quote, or newline inside a quoted message is preserved) with a configurable delimiter.
 */
export function parseCsv(text: string, delim = ';'): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Message bodies that are not real content and must be dropped. */
const NOISE = new Set(['ciphertext', 'System notification']);

/**
 * Parse a WAnalysis WhatsApp CSV export into a clean transcript.
 *
 * WAnalysis columns (semicolon-delimited, UTF-8 BOM): Date1;Date2;Time;UserPhone;UserName;
 * MessageBody;MediaType;MediaLink;MediaCaption;QuotedMessage;QuotedUserName;QuotedMessageDate;
 * QuotedMessageTime. The account owner's messages carry UserName "You" -> sender 'me'; everyone
 * else -> 'them'. System notifications, undecryptable ("ciphertext"), and media-only/empty rows
 * are skipped (text-style learning needs real text).
 */
export function parseWanalysisCsv(csv: string): TranscriptTurn[] {
  const rows = parseCsv(csv, ';');
  if (rows.length < 2) return [];
  const header = rows[0];
  const col = (name: string) => header.indexOf(name);
  const iDate = col('Date2');
  const iTime = col('Time');
  const iUser = col('UserName');
  const iBody = col('MessageBody');
  const iMedia = col('MediaType');

  const turns: TranscriptTurn[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const body = (cols[iBody] ?? '').trim();
    const media = (cols[iMedia] ?? '').trim();
    if (!body || media === 'system' || NOISE.has(body)) continue;
    const sender: 'me' | 'them' = (cols[iUser] ?? '').trim() === 'You' ? 'me' : 'them';
    turns.push({ ts: `${(cols[iDate] ?? '').trim()} ${(cols[iTime] ?? '').trim()}`.trim(), sender, text: body });
  }
  return turns;
}
