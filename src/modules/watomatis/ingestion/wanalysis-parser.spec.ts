import { parseWanalysisCsv, parseCsv } from './wanalysis-parser';

const HEADER =
  'Date1;Date2;Time;UserPhone;UserName;MessageBody;MediaType;MediaLink;MediaCaption;QuotedMessage;QuotedUserName;QuotedMessageDate;QuotedMessageTime';

describe('parseCsv', () => {
  it('keeps a delimiter that appears inside a quoted field', () => {
    const rows = parseCsv('a;b\n"x;y";z', ';');
    expect(rows[1]).toEqual(['x;y', 'z']);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    const rows = parseCsv('a\n"say ""hi"""', ';');
    expect(rows[1]).toEqual(['say "hi"']);
  });
});

describe('parseWanalysisCsv', () => {
  it('maps "You" to me and others to them, building the timestamp', () => {
    const csv = [
      HEADER,
      ';2026-06-22;22:08:28;628111;628111;No aku second number;;;;;;;',
      ';2026-06-22;22:52:24;;You;Aamiin;;;;;;;',
    ].join('\n');
    const turns = parseWanalysisCsv(csv);
    expect(turns).toEqual([
      { ts: '2026-06-22 22:08:28', sender: 'them', text: 'No aku second number' },
      { ts: '2026-06-22 22:52:24', sender: 'me', text: 'Aamiin' },
    ]);
  });

  it('skips system notifications, ciphertext, and empty/media-only rows', () => {
    const csv = [
      HEADER,
      '2026-06-23;2026-06-23;06:49:04;628111;628111;System notification;system;;;;;;',
      ';2026-06-22;22:21:41;;You;ciphertext;;;;;;;',
      ';2026-06-22;22:54:24;628111;628111;;ciphertext;;;;;;',
      ';2026-06-22;22:55:00;;You;Halo kak;;;;;;;',
    ].join('\n');
    const turns = parseWanalysisCsv(csv);
    expect(turns).toEqual([{ ts: '2026-06-22 22:55:00', sender: 'me', text: 'Halo kak' }]);
  });

  it('returns empty for an empty or header-only file', () => {
    expect(parseWanalysisCsv('')).toEqual([]);
    expect(parseWanalysisCsv(HEADER)).toEqual([]);
  });
});
