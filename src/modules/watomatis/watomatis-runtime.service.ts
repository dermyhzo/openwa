import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { HookManager, HookContext, HookResult } from '../../core/hooks';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { MessageService } from '../message/message.service';
import { MessageDirection } from '../message/entities/message.entity';
import { LicenseService } from '../license/license.service';
import { WatomatisStore, WatomatisProfile } from './watomatis-store.service';
import { WatomatisSettingsStore } from './watomatis-settings-store.service';
import { WatomatisDraftStore } from './watomatis-drafts.service';
import { ApimartChat } from './learning/llm-chat';
import { buildReplyPrompt } from './reply-prompt';
import { retrieveKnowledge } from './retriever';
import { ShippingConnector } from './connectors/shipping.connector';
import { ScalevConnector, ScalevCourierQuote } from './connectors/scalev.connector';
import { WatomatisOrderStore, WatomatisOrder, OrderItem } from './watomatis-order-store.service';
import type { WatomatisSettings } from './watomatis-settings-store.service';

// Small de-dup window so a burst of messages doesn't double-fire; still answers normal follow-ups.
const COOLDOWN_MS = 1_500;

// Anti-ban: max typing delay we'll ever sleep (ms).
const MAX_TYPING_DELAY_MS = 15_000;

// A customer ASSERTING they already paid ("sudah bayar", "udah transfer", "barusan tf"...). This only
// TRIGGERS a real check against Scalev; access is granted by the verified order, never by these words.
// Deliberately does NOT match future intent ("mau bayar", "cara bayar") so it fires only on a claim.
const CLAIMS_PAYMENT =
  /\b(sudah|udah|udh|dah|telah|barusan|baru\s*saja|abis|habis)\s*(bayar|byr|transfer|tf|trf|bayarnya|lunas|melunasi|checkout|order(?:in)?)\b|\b(sudah|udah|dah)\s*(saya|aku|ku)?\s*(bayar|transfer|tf)\b|\b(bukti|proof)\s*(bayar|transfer|tf)\b|sudah\s*di\s*bayar|udah\s*dibayar|\blunas\b|\bpaid\b/i;

/** WhatsApp chatId ("6281234...@c.us") -> raw digits, for matching against a Scalev order phone. */
function phoneFromChatId(chatId: string): string {
  return String(chatId ?? '').split('@')[0].replace(/\D/g, '');
}

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
    private readonly settings: WatomatisSettingsStore,
    private readonly license: LicenseService,
    private readonly scalev: ScalevConnector,
    private readonly orders: WatomatisOrderStore,
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
      // Server-side license gate: no active license = no replies/drafts
      if (!(await this.license.isActive())) {
        return { continue: true };
      }

      const profile = await this.store.get(sessionId);
      if (!profile || profile.mode === 'off' || !profile.apiKey) {
        return { continue: true };
      }

      const last = this.lastReplyAt.get(m.chatId);
      if (last && Date.now() - last < COOLDOWN_MS) {
        return { continue: true };
      }

      const settings = await this.settings.get();
      const history = await this.recentHistory(sessionId, m.chatId, m.body);
      const { reply, canAnswer, order } = await this.generateReply(profile, m.body, m.chatId, settings, history);

      const orderConfirmation = await this.handleOrder(profile, settings, sessionId, m.chatId, order);

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

        const baseText =
          canAnswer && reply
            ? reply
            : profile.fallbackMessage?.trim() || 'Mohon tunggu ya kak, CS kami akan segera membantu.';
        const text = orderConfirmation ? `${baseText}\n\n${orderConfirmation}` : baseText;
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

  /** Recent turns for this chat (oldest first), minus the just-arrived message, so the agent has context. */
  private async recentHistory(
    sessionId: string,
    chatId: string,
    currentBody: string,
  ): Promise<{ role: 'cust' | 'me'; text: string }[]> {
    try {
      const { messages } = await this.messages.getMessages(sessionId, { chatId, limit: 80 });
      const turns = messages
        .filter(msg => msg.body?.trim())
        .reverse()
        .map(msg => ({
          role: (msg.direction === MessageDirection.OUTGOING ? 'me' : 'cust') as 'me' | 'cust',
          text: msg.body.trim(),
        }));
      const cur = currentBody.trim();
      if (turns.length && turns[turns.length - 1].role === 'cust' && turns[turns.length - 1].text === cur) {
        turns.pop();
      }
      return turns.slice(-60);
    } catch {
      return [];
    }
  }

  /**
   * FAITHFUL test harness: runs the EXACT reply path the live bot uses (profile + generateReply +
   * Scalev payment verification + enforceVoice), for one message, without needing a WhatsApp
   * connection. Behind the controller's API-key guard. So a test reflects what the bot really sends.
   */
  async debugReply(
    sessionId: string,
    text: string,
    opts: { chatId?: string; history?: { role: 'cust' | 'me'; text: string }[] } = {},
  ): Promise<{ reply: string; canAnswer: boolean; paymentStatus: string; order?: Record<string, unknown> }> {
    const profile = await this.store.get(sessionId);
    if (!profile) throw new Error(`No profile for session ${sessionId}`);
    const settings = await this.settings.get();
    const chatId = opts.chatId || '628000000000@c.us';
    const { reply, canAnswer, order, paymentStatus } = await this.generateReply(
      profile,
      text,
      chatId,
      settings,
      opts.history ?? [],
    );
    return { reply, canAnswer, paymentStatus, order };
  }

  private async generateReply(
    profile: WatomatisProfile,
    userText: string,
    chatId: string,
    settings: WatomatisSettings,
    history: { role: 'cust' | 'me'; text: string }[] = [],
  ): Promise<{ reply: string; canAnswer: boolean; order?: Record<string, unknown>; paymentStatus: 'verified' | 'unverified' | 'unknown' }> {
    const llm = new ApimartChat({
      baseUrl: profile.apiBaseUrl || 'https://api.apimart.ai/v1',
      apiKey: profile.apiKey,
      model: profile.model || 'gpt-4o-mini',
      temperature: 0.4,
    });
    const nowText = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    const persona = profile.voiceCard?.summary ?? '';
    const qna = profile.qna ?? [];

    const sh = settings.shipping;
    const shippingEnabled = !!(sh.enabled && sh.apiKey && sh.originVillageCode);
    const sc = settings.scalev;
    const scalevEnabled = !!(sc.enabled && sc.apiKey && sc.storeUniqueId);

    // Payment gate: a customer who merely SAYS "sudah bayar" must be checked against Scalev before
    // any access/after-sales is granted. Their word is not proof; only a real paid order is.
    let paymentStatus: 'verified' | 'unverified' | 'unknown' = 'unknown';
    if (scalevEnabled && CLAIMS_PAYMENT.test(userText)) {
      const paid = await this.scalev.findPaidOrder(sc.apiKey, phoneFromChatId(chatId), sc.storeUniqueId);
      paymentStatus = paid ? 'verified' : 'unverified';
      this.logger.log(
        `Payment claim from ${chatId} -> ${paymentStatus}${paid ? ` (order ${paid.orderId} ${paid.status})` : ' (no paid order found)'}`,
      );
    }

    const orderCatalog = scalevEnabled
      ? sc.catalog.map(c => ({
          ref: c.ref,
          name: c.name,
          price: c.price ? `Rp${c.price.toLocaleString('id-ID')}` : undefined,
          // Digital products carry no weight; this routes fulfilment (payment link vs shipped/ongkir order).
          isDigital: c.weightGram === 0,
        }))
      : undefined;

    const knowledgeOpts = {
      // RAG: send only the KB chunks relevant to this message instead of stuffing the whole doc (cuts latency + tokens).
      brandKnowledge: retrieveKnowledge(profile.brandKnowledge ?? '', userText),
      products: profile.products,
    };
    const promptOpts = {
      detectOngkir: shippingEnabled,
      captureOrder: scalevEnabled,
      orderCatalog,
      history,
      goal: profile.goal,
      paymentStatus,
      ...knowledgeOpts,
    };
    const res = await llm.json(buildReplyPrompt(persona, qna, nowText, promptOpts), userText);
    let reply = typeof res.reply === 'string' ? res.reply : '';
    let canAnswer = res.canAnswer === true;
    const order = res.order && typeof res.order === 'object' ? (res.order as Record<string, unknown>) : undefined;

    if (shippingEnabled) {
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
          const res2 = await llm.json(
            buildReplyPrompt(persona, qna, nowText, { ...promptOpts, detectOngkir: false, shippingFacts: facts }),
            userText,
          );
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

    reply = enforceVoice(reply, persona);

    return { reply, canAnswer, order, paymentStatus };
  }

  /**
   * Merge captured order slots; when ready+complete, book (auto) or queue a booking draft (supervised).
   * Returns a confirmation line to append to the auto-mode reply, or '' (supervised / not ready / failed).
   */
  private async handleOrder(
    profile: WatomatisProfile,
    settings: WatomatisSettings,
    sessionId: string,
    chatId: string,
    order: Record<string, unknown> | undefined,
  ): Promise<string> {
    const sc = settings.scalev;
    if (!sc.enabled || !sc.apiKey || !sc.storeUniqueId || !order || order['intent'] !== true) return '';

    const items: OrderItem[] = Array.isArray(order['items'])
      ? (order['items'] as Record<string, unknown>[])
          .map(i => ({ ref: String(i['ref'] ?? ''), quantity: Number(i['quantity'] ?? 0) }))
          .filter(i => i.ref && i.quantity > 0)
      : [];

    // Digital products are fulfilled via the payment link (customer self-checkout on Scalev), never a shipped order.
    const digitalRefs = new Set(sc.catalog.filter(c => c.weightGram === 0).map(c => c.ref));
    if (items.length > 0 && items.every(i => digitalRefs.has(i.ref))) {
      // A digital-only order that still carries an address suggests a PHYSICAL product mis-tagged digital
      // (blank/zero Scalev weight). Surface it so a shippable order is not dropped invisibly.
      if (typeof order['address'] === 'string' && order['address'].trim()) {
        this.logger.warn(
          'Skipped booking an all-digital order that has a shipping address; if this should ship, set a real weight on the product in Scalev (weight 0 is treated as digital).',
        );
      }
      return '';
    }

    const pm = order['paymentMethod'];
    const merged = await this.orders.merge(sessionId, chatId, {
      customerName: typeof order['customerName'] === 'string' ? (order['customerName'] as string) : undefined,
      phone: typeof order['phone'] === 'string' ? (order['phone'] as string) : undefined,
      address: typeof order['address'] === 'string' ? (order['address'] as string) : undefined,
      postalCode: typeof order['postalCode'] === 'string' ? (order['postalCode'] as string) : undefined,
      city: typeof order['city'] === 'string' ? (order['city'] as string) : undefined,
      paymentMethod: pm === 'cod' || pm === 'transfer' ? pm : undefined,
      courierPreference: typeof order['courierPreference'] === 'string' ? (order['courierPreference'] as string) : undefined,
      items: items.length > 0 ? items : undefined,
    });

    if (order['readyToBook'] !== true || !orderRequiredComplete(merged)) return '';

    if (profile.mode !== 'auto') {
      await this.orders.update(merged.id, { status: 'ready' });
      return '';
    }

    const result = await this.bookToScalev(settings, merged);
    if ('error' in result) {
      await this.orders.update(merged.id, { status: 'failed', lastError: result.error });
      this.logger.error(`Scalev order failed: ${result.error}`);
      return '';
    }
    await this.orders.update(merged.id, { status: 'booked', scalevOrderId: result.orderId });
    return result.confirmation;
  }

  /** Resolve location + courier, then create the Scalev order. Best-effort courier. */
  async bookToScalev(
    settings: WatomatisSettings,
    o: WatomatisOrder,
  ): Promise<{ orderId: string; confirmation: string } | { error: string }> {
    const sc = settings.scalev;
    const byRef = new Map(sc.catalog.map(c => [c.ref, c]));
    const variants = o.items.map(it => ({ item: it, entry: byRef.get(it.ref) }));
    if (variants.some(v => !v.entry)) return { error: 'Item not found in synced catalog' };

    const ordervariants = variants.map(v => ({ variant_unique_id: v.entry!.variantUniqueId, quantity: v.item.quantity }));
    const totalWeight = variants.reduce((sum, v) => sum + (v.entry!.weightGram || 0) * v.item.quantity, 0) || 1;

    const payload: Record<string, unknown> = {
      store_unique_id: sc.storeUniqueId,
      customer_name: o.customerName,
      customer_phone: o.phone,
      address: o.address,
      postal_code: o.postalCode,
      ordervariants,
      payment_method: o.paymentMethod === 'transfer' ? 'bank_transfer' : 'cod',
    };

    // Best-effort destination + courier (failure does not block the order).
    const locations = await this.scalev.searchLocation(sc.apiKey, o.city || o.address || '');
    let courierLine = '';
    if (locations.length > 0 && sc.warehouseId) {
      const locationId = locations[0].locationId;
      payload['location_id'] = locationId;
      const quotes = await this.scalev.shippingCosts(sc.apiKey, { warehouseId: sc.warehouseId, locationId, weight: totalWeight });
      const courier = pickCourier(quotes, o.courierPreference);
      if (courier) {
        payload['courier_service_id'] = courier.courierServiceId;
        payload['shipment_provider_code'] = courier.shipmentProviderCode;
        payload['shipping_cost'] = courier.price;
        courierLine = ` via ${courier.courierName} (ongkir Rp${courier.price.toLocaleString('id-ID')})`;
      }
    } else {
      payload['notes'] = 'Ongkir/kurir belum di-resolve otomatis, finalisasi di Scalev.';
    }

    const res = await this.scalev.createOrder(sc.apiKey, payload);
    if ('error' in res) return res;
    return {
      orderId: res.orderId,
      confirmation: `Order kakak sudah kami catat (no ${res.orderId})${courierLine}. Diproses ya kak 🙏`,
    };
  }
}

/**
 * Hard-enforce the voice rules the persona states but a small LLM occasionally slips past (a stray
 * "!", "aku" instead of "saya", "kamu"/"anda" instead of "kak"). Only rewrites what the persona
 * EXPLICITLY forbids, so an agent whose learned voice really uses those keeps them untouched.
 */
export function enforceVoice(text: string, persona: string): string {
  let out = text;
  if (/tanda seru/i.test(persona)) out = out.replace(/!+/g, '.');
  if (/jangan\s*["']?aku/i.test(persona)) out = out.replace(/\baku\b/gi, 'saya');
  if (/jangan\s*["']?(kamu|anda)/i.test(persona)) out = out.replace(/\bkamu\b/gi, 'kakak').replace(/\banda\b/gi, 'kakak');
  return out;
}

const REQUIRED_KEYS = ['customerName', 'phone', 'address', 'postalCode', 'city', 'paymentMethod'] as const;

/** Cheapest quote, unless a preference matches a courier name (case-insensitive substring). */
export function pickCourier(quotes: ScalevCourierQuote[], preference?: string): ScalevCourierQuote | null {
  if (quotes.length === 0) return null;
  if (preference) {
    const pref = preference.toLowerCase();
    const match = quotes.find(q => q.courierName.toLowerCase().includes(pref));
    if (match) return match;
  }
  return [...quotes].sort((a, b) => a.price - b.price)[0];
}

/** True when every required order slot (and at least one item) is present. */
export function orderRequiredComplete(
  o: Pick<WatomatisOrder, 'customerName' | 'phone' | 'address' | 'postalCode' | 'city' | 'paymentMethod' | 'items'>,
): boolean {
  for (const k of REQUIRED_KEYS) {
    const v = o[k];
    if (typeof v !== 'string' || !v.trim()) return false;
  }
  return Array.isArray(o.items) && o.items.length > 0;
}
