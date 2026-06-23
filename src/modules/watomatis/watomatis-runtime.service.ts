import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { HookManager, HookContext, HookResult } from '../../core/hooks';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { MessageService } from '../message/message.service';
import { WatomatisStore, WatomatisProfile } from './watomatis-store.service';
import { WatomatisDraftStore } from './watomatis-drafts.service';
import { ApimartChat } from './learning/llm-chat';
import { buildReplyPrompt } from './reply-prompt';

// Small de-dup window so a burst of messages doesn't double-fire; still answers normal follow-ups.
const COOLDOWN_MS = 1_500;

/**
 * The Watomatis agent at runtime: listens on inbound messages and, for sessions that have a saved
 * profile in `supervised`/`auto` mode, drafts a reply in the learned voice (Voice Card + Q&A).
 * `auto` sends it; `supervised` stores it for human approval. Never throws (keeps the hook chain alive).
 */
@Injectable()
export class WatomatisRuntime implements OnModuleInit {
  private readonly logger = new Logger('WatomatisRuntime');
  private readonly lastReplyAt = new Map<string, number>();

  constructor(
    private readonly hooks: HookManager,
    private readonly store: WatomatisStore,
    private readonly drafts: WatomatisDraftStore,
    private readonly messages: MessageService,
  ) {}

  onModuleInit(): void {
    this.hooks.register('watomatis', 'message:received', ctx =>
      this.onMessage(ctx as HookContext<IncomingMessage>),
    );
    this.logger.log('Watomatis runtime registered on message:received');
  }

  private async onMessage(ctx: HookContext<IncomingMessage>): Promise<HookResult> {
    const m = ctx.data;
    const sessionId = ctx.sessionId;
    if (ctx.source !== 'Engine' || !sessionId || m.fromMe || m.isGroup || m.isStatusBroadcast || !m.body?.trim()) {
      return { continue: true };
    }

    try {
      const profile = await this.store.get(sessionId);
      if (!profile || profile.mode === 'off' || !profile.apiKey) {
        return { continue: true };
      }

      const last = this.lastReplyAt.get(m.chatId);
      if (last && Date.now() - last < COOLDOWN_MS) {
        return { continue: true };
      }

      const { reply, canAnswer } = await this.generateReply(profile, m.body);

      if (profile.mode === 'auto') {
        const text =
          canAnswer && reply
            ? reply
            : profile.fallbackMessage?.trim() || 'Mohon tunggu ya kak, CS kami akan segera membantu.';
        await this.messages.sendText(sessionId, { chatId: m.chatId, text });
        this.lastReplyAt.set(m.chatId, Date.now());
      } else {
        await this.drafts.append({ sessionId, chatId: m.chatId, incoming: m.body, reply, canAnswer });
      }
    } catch (err) {
      this.logger.error('Watomatis reply failed', err as Error);
    }

    return { continue: true };
  }

  private async generateReply(
    profile: WatomatisProfile,
    userText: string,
  ): Promise<{ reply: string; canAnswer: boolean }> {
    const llm = new ApimartChat({
      baseUrl: profile.apiBaseUrl || 'https://api.apimart.ai/v1',
      apiKey: profile.apiKey,
      model: profile.model || 'gpt-4o-mini',
      temperature: 0.7,
    });
    const nowText = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    const sys = buildReplyPrompt(profile.voiceCard?.summary ?? '', profile.qna ?? [], nowText);
    const res = await llm.json(sys, userText);
    return {
      reply: typeof res.reply === 'string' ? res.reply : '',
      canAnswer: res.canAnswer === true,
    };
  }
}
