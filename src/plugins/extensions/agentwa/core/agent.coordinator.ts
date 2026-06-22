import { BrandProfilePort, ChatGateway, GuardrailPort, IncomingTurn, KnowledgePort, LlmPort } from './ports';
import { buildSystemPrompt } from './prompt';

/**
 * Orchestrates one inbound turn: guard -> resolve brand -> retrieve knowledge -> LLM ->
 * confidence gate -> reply (or fallback) -> record. Never throws; on any error it falls back.
 */
export class AgentCoordinator {
  constructor(
    private readonly brand: BrandProfilePort,
    private readonly guard: GuardrailPort,
    private readonly knowledge: KnowledgePort,
    private readonly llm: LlmPort,
    private readonly chat: ChatGateway,
    private readonly language: string,
  ) {}

  async handle(turn: IncomingTurn): Promise<void> {
    if (!(await this.guard.shouldHandle(turn))) {
      return;
    }
    const profile = this.brand.resolve(turn.sessionId);
    const knowledge = this.knowledge.retrieve(profile, turn.text);
    const systemPrompt = buildSystemPrompt(profile, knowledge, this.language);

    let reply: string;
    try {
      const result = await this.llm.complete({ systemPrompt, userText: turn.text });
      reply = result.canAnswer && result.reply ? result.reply : profile.fallbackMessage;
    } catch {
      reply = profile.fallbackMessage;
    }

    await this.chat.sendText(turn.sessionId, turn.chatId, reply);
    await this.guard.recordReply(turn.chatId);
  }
}
