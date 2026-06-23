import { Injectable, BadRequestException } from '@nestjs/common';
import { parseWanalysisCsv } from './ingestion/wanalysis-parser';
import { extractVoiceCard, mineQna } from './learning/voice-extractor';
import { ApimartChat } from './learning/llm-chat';
import type { ChatLlm } from './learning/llm-chat';
import type { VoiceCard, MinedQna } from './learning/types';
import type { TranscriptTurn } from './ingestion/types';
import { SessionService } from '../session/session.service';

export interface LearnResult {
  stats: { turns: number; me: number; them: number };
  voiceCard: VoiceCard;
  qna: MinedQna[];
}

@Injectable()
export class WatomatisService {
  constructor(private readonly sessionService: SessionService) {}

  async learnFromCsv(
    csv: string,
    llmConfig: { baseUrl: string; apiKey: string; model: string },
    llmOverride?: ChatLlm,
  ): Promise<LearnResult> {
    const turns = parseWanalysisCsv(csv);
    return this.learnFromTurns(turns, llmConfig, llmOverride);
  }

  async learnFromSession(
    sessionId: string,
    llmConfig: { baseUrl: string; apiKey: string; model: string },
    limit: number = 500,
    llmOverride?: ChatLlm,
  ): Promise<LearnResult> {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException(`Session '${sessionId}' is not active. Start the session first.`);
    }

    const chats = await engine.getChats();
    const nonGroupChats = chats.filter(c => !c.isGroup);

    const allTurns: TranscriptTurn[] = [];
    for (const chat of nonGroupChats) {
      if (allTurns.length >= limit) break;
      const remaining = limit - allTurns.length;
      const messages = await engine.getChatHistory(chat.id, remaining);
      for (const msg of messages) {
        if (msg.type !== 'text' || !msg.body?.trim()) continue;
        const ts = new Date(msg.timestamp * 1000)
          .toISOString()
          .replace('T', ' ')
          .slice(0, 19);
        allTurns.push({ sender: msg.fromMe ? 'me' : 'them', text: msg.body.trim(), ts });
      }
    }

    return this.learnFromTurns(allTurns, llmConfig, llmOverride);
  }

  async learnFromTurns(
    turns: TranscriptTurn[],
    llmConfig: { baseUrl: string; apiKey: string; model: string },
    llmOverride?: ChatLlm,
  ): Promise<LearnResult> {
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
