import { WatomatisService } from './watomatis.service';
import type { ChatLlm } from './learning/llm-chat';
import type { VoiceCard } from './learning/types';

/** Minimal WAnalysis CSV with two turns: customer then owner reply. */
const SAMPLE_CSV = [
  'Date1;Date2;Time;UserPhone;UserName;MessageBody;MediaType;MediaLink;MediaCaption;QuotedMessage;QuotedUserName;QuotedMessageDate;QuotedMessageTime',
  '01/06/2024;2024-06-01;10:00:00;+62811;Customer;Halo, ada produk x?;text;;;;;; ',
  '01/06/2024;2024-06-01;10:01:00;+62812;You;Hai! Ada kak, silakan cek katalog kami ya 😊;text;;;;;; ',
].join('\n');

const FAKE_VOICE_CARD: VoiceCard = {
  tone: 'friendly',
  formality: 'casual',
  emojiUsage: 'frequent',
  greetings: ['Hai!'],
  closings: ['ya 😊'],
  quirks: [],
  summary: 'CS yang ramah',
  avgReplyChars: 42,
};

/** Fake LLM that returns a plausible voice card and Q&A without hitting the network. */
const fakeLlm: ChatLlm = {
  async json(systemPrompt: string) {
    if (systemPrompt.includes('Voice Card')) {
      return FAKE_VOICE_CARD as unknown as Record<string, unknown>;
    }
    // mineQna path
    return { qna: [{ question: 'ada produk x?', answer: 'Ada kak, silakan cek katalog kami ya' }] };
  },
};

describe('WatomatisService', () => {
  let service: WatomatisService;

  beforeEach(() => {
    service = new WatomatisService();
  });

  it('parses CSV and returns correct stats', async () => {
    const result = await service.learnFromCsv(
      SAMPLE_CSV,
      { baseUrl: 'http://noop', apiKey: 'noop', model: 'noop' },
      fakeLlm,
    );

    expect(result.stats.turns).toBe(2);
    expect(result.stats.me).toBe(1);
    expect(result.stats.them).toBe(1);
  });

  it('returns voiceCard from LLM', async () => {
    const result = await service.learnFromCsv(
      SAMPLE_CSV,
      { baseUrl: 'http://noop', apiKey: 'noop', model: 'noop' },
      fakeLlm,
    );

    expect(result.voiceCard.tone).toBe('friendly');
    expect(result.voiceCard.formality).toBe('casual');
    expect(result.voiceCard.avgReplyChars).toBeGreaterThan(0);
  });

  it('returns mined Q&A pairs', async () => {
    const result = await service.learnFromCsv(
      SAMPLE_CSV,
      { baseUrl: 'http://noop', apiKey: 'noop', model: 'noop' },
      fakeLlm,
    );

    expect(result.qna.length).toBeGreaterThan(0);
    expect(result.qna[0]).toHaveProperty('question');
    expect(result.qna[0]).toHaveProperty('answer');
  });

  it('returns empty stats for empty CSV', async () => {
    const result = await service.learnFromCsv(
      'Date1;Date2;Time;UserPhone;UserName;MessageBody;MediaType;MediaLink;MediaCaption;QuotedMessage;QuotedUserName;QuotedMessageDate;QuotedMessageTime',
      { baseUrl: 'http://noop', apiKey: 'noop', model: 'noop' },
      fakeLlm,
    );

    expect(result.stats.turns).toBe(0);
    expect(result.stats.me).toBe(0);
    expect(result.stats.them).toBe(0);
  });
});
