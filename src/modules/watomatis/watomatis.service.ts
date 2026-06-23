import { Injectable } from '@nestjs/common';
import { parseWanalysisCsv } from './ingestion/wanalysis-parser';
import { extractVoiceCard, mineQna } from './learning/voice-extractor';
import { ApimartChat } from './learning/llm-chat';
import type { ChatLlm } from './learning/llm-chat';
import type { VoiceCard, MinedQna } from './learning/types';

export interface LearnResult {
  stats: { turns: number; me: number; them: number };
  voiceCard: VoiceCard;
  qna: MinedQna[];
}

@Injectable()
export class WatomatisService {
  async learnFromCsv(
    csv: string,
    llmConfig: { baseUrl: string; apiKey: string; model: string },
    llmOverride?: ChatLlm,
  ): Promise<LearnResult> {
    const turns = parseWanalysisCsv(csv);
    const me = turns.filter(t => t.sender === 'me').length;
    const them = turns.filter(t => t.sender === 'them').length;

    const llm = llmOverride ?? new ApimartChat(llmConfig);
    const [voiceCard, qna] = await Promise.all([
      extractVoiceCard(turns, llm),
      mineQna(turns, llm),
    ]);

    return { stats: { turns: turns.length, me, them }, voiceCard, qna };
  }
}
