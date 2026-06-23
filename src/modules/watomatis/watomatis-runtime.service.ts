import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { HookManager, HookContext, HookResult } from '../../core/hooks';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { MessageService } from '../message/message.service';
import { WatomatisStore, WatomatisProfile } from './watomatis-store.service';
import { WatomatisDraftStore } from './watomatis-drafts.service';
import { ApimartChat } from './learning/llm-chat';
import { buildReplyPrompt } from './reply-prompt';
import { ShippingConnector } from './connectors/shipping.connector';

// Small de-dup window so a burst of messages doesn't double-fire; still answers normal follow-ups.
const COOLDOWN_MS = 1_500;

// Anti-ban: max typing delay we'll ever sleep (ms).
const MAX_TYPING_DELAY_MS = 15_000;

/**
 * The Watomatis agent at runtime: listens on inbound messages and, for sessions that have a saved
 * profile in `supervised`/`auto` mode, drafts a reply in the learned voice (Voice Card + Q&A).
 * `auto` sends it; `supervised` stores it for human approval. Never throws (keeps the hook chain alive).
 */
@Injectable()
export class WatomatisRuntime implements OnModuleInit {
  private readonly logger = new Logger('WatomatisRuntime');
  private readonly lastReplyAt = new Map<string, number>();

  // Anti-ban: daily send cap per sessionId.  Resets when the Asia/Jakarta date changes.
  private readonly dailyCount = new Map<string, { date: string; count: number }>();

  constructor(
    private readonly hooks: HookManager,
    private readonly store: WatomatisStore,
    private readonly drafts: WatomatisDraftStore,
    private readonly messages: MessageService,
    private readonly shipping: ShippingConnector,
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
        const g = profile.guardrails;

        // Business hours check
        if (g?.businessHours && !this.withinBusinessHours(g.businessHours)) {
          return { continue: true };
        }

        // Daily cap check
        if (g?.dailyCap !== undefined && g.dailyCap > 0) {
          const todayJkt = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
          const entry = this.dailyCount.get(sessionId);
          const current = entry && entry.date === todayJkt ? entry.count : 0;
          if (current >= g.dailyCap) {
            return { continue: true };
          }
        }

        // Typing delay
        if (g?.typingDelayMs && g.typingDelayMs > 0) {
          await new Promise(r => setTimeout(r, Math.min(g.typingDelayMs!, MAX_TYPING_DELAY_MS)));
        }

        const text =
          canAnswer && reply
            ? reply
            : profile.fallbackMessage?.trim() || 'Mohon tunggu ya kak, CS kami akan segera membantu.';
        await this.messages.sendText(sessionId, { chatId: m.chatId, text });
        this.lastReplyAt.set(m.chatId, Date.now());

        // Increment daily cap counter after successful send
        if (g?.dailyCap !== undefined && g.dailyCap > 0) {
          const todayJkt = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
          const entry = this.dailyCount.get(sessionId);
          const current = entry && entry.date === todayJkt ? entry.count : 0;
          this.dailyCount.set(sessionId, { date: todayJkt, count: current + 1 });
        }
      } else {
        await this.drafts.append({ sessionId, chatId: m.chatId, incoming: m.body, reply, canAnswer });
      }
    } catch (err) {
      this.logger.error('Watomatis reply failed', err as Error);
    }

    return { continue: true };
  }

  /** Returns true if the current Asia/Jakarta time is within [start, end] (inclusive, "HH:MM" format). */
  withinBusinessHours(hours: { start: string; end: string }): boolean {
    const nowHHMM = new Date().toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
    });
    return nowHHMM >= hours.start && nowHHMM <= hours.end;
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
    const persona = profile.voiceCard?.summary ?? '';
    const qna = profile.qna ?? [];
    const sh = profile.shipping;
    const shippingEnabled = !!(sh?.enabled && sh.apiKey && sh.originVillageCode);

    const knowledgeOpts = {
      brandKnowledge: profile.brandKnowledge,
      products: profile.products,
    };
    const res = await llm.json(buildReplyPrompt(persona, qna, nowText, { detectOngkir: shippingEnabled, ...knowledgeOpts }), userText);
    let reply = typeof res.reply === 'string' ? res.reply : '';
    let canAnswer = res.canAnswer === true;

    if (shippingEnabled && sh) {
      const o = res.ongkir as
        | { needed?: boolean; destination?: string; city?: string; weight?: number | null }
        | undefined;
      if (o?.needed && o.destination && o.city) {
        const weight = typeof o.weight === 'number' && o.weight > 0 ? o.weight : sh.defaultWeightKg || 1;
        const result = await this.shipping.cekOngkir(
          sh.originVillageCode,
          String(o.destination),
          String(o.city),
          weight,
          sh.apiKey,
        );
        if ('quotes' in result && result.quotes.length > 0) {
          const factsList = result.quotes
            .map(q => `- ${q.courierName}: Rp${q.price.toLocaleString('id-ID')}${q.estimation ? ` (estimasi ${q.estimation})` : ''}`)
            .join('\n');
          const facts = `Tujuan: ${result.destinationName} · berat ${weight} kg\n${factsList}`;
          const res2 = await llm.json(buildReplyPrompt(persona, qna, nowText, { shippingFacts: facts, ...knowledgeOpts }), userText);
          if (typeof res2.reply === 'string' && res2.reply) {
            reply = res2.reply;
            canAnswer = true;
          }
        } else if ('error' in result) {
          reply = `Maaf kak, ongkir ke ${o.destination}, ${o.city} belum bisa saya hitung otomatis. Boleh info kecamatan/kelurahan + kotanya lebih lengkap ya? 🙏`;
          canAnswer = true;
        }
      }
    }

    return { reply, canAnswer };
  }
}
