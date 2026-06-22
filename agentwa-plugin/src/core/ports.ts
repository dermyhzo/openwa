// Framework-agnostic contracts for the AgentWA core. NO NestJS/TypeORM/engine imports.

/** Normalized inbound message the coordinator works on (mapped from IncomingMessage). */
export interface IncomingTurn {
  sessionId: string;
  chatId: string;
  messageId: string;
  text: string;
  fromMe: boolean;
  isGroup: boolean;
  isStatusBroadcast: boolean;
  source: string; // 'Engine' for real inbound messages
}

/** Per-brand persona + knowledge (one brand == one WhatsApp session/number). */
export interface BrandProfile {
  name: string;
  systemPersona: string;
  businessProfile: string;
  faq: string;
  fallbackMessage: string;
}

/** Structured LLM output. `canAnswer=false` => not grounded => use fallback + handoff. */
export interface LlmResult {
  reply: string;
  canAnswer: boolean;
}

export interface BrandProfilePort {
  resolve(sessionId: string): BrandProfile;
}

export interface KnowledgePort {
  retrieve(profile: BrandProfile, query: string): string;
}

export interface LlmPort {
  complete(input: { systemPrompt: string; userText: string }): Promise<LlmResult>;
}

export interface GuardrailPort {
  /** True if the bot should auto-reply to this turn. */
  shouldHandle(turn: IncomingTurn): Promise<boolean>;
  /** Record that a reply was sent (for cooldown bookkeeping). */
  recordReply(chatId: string): Promise<void>;
}

export interface ChatGateway {
  sendText(sessionId: string, chatId: string, text: string): Promise<void>;
}

export interface Clock {
  now(): number; // epoch ms
}
