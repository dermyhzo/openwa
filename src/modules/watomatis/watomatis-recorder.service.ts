import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { HookManager, HookContext, HookResult } from '../../core/hooks';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { WatomatisStore } from './watomatis-store.service';
import { WatomatisRecordingStore } from './watomatis-recording-store.service';

/**
 * Listens on message:received (customer question) and message:sent (human/bot answer)
 * for sessions that have a Watomatis profile, and records matched Q&A pairs.
 */
@Injectable()
export class WatomatisRecorder implements OnModuleInit {
  private readonly logger = new Logger('WatomatisRecorder');
  /** Key: `${sessionId}:${chatId}` → pending customer question */
  private readonly pending = new Map<string, string>();

  constructor(
    private readonly hooks: HookManager,
    private readonly store: WatomatisStore,
    private readonly recordingStore: WatomatisRecordingStore,
  ) {}

  onModuleInit(): void {
    this.hooks.register('watomatis-recorder', 'message:received', ctx =>
      this.onReceived(ctx as HookContext<IncomingMessage>),
    );
    this.hooks.register('watomatis-recorder', 'message:sent', ctx =>
      this.onSent(ctx as HookContext<IncomingMessage>),
    );
    this.logger.log('WatomatisRecorder registered on message:received + message:sent');
  }

  private async onReceived(ctx: HookContext<IncomingMessage>): Promise<HookResult> {
    const m = ctx.data;
    const sessionId = ctx.sessionId;
    if (
      ctx.source !== 'Engine' ||
      !sessionId ||
      m.fromMe ||
      m.isGroup ||
      m.isStatusBroadcast ||
      !m.body?.trim()
    ) {
      return { continue: true };
    }

    try {
      const profile = await this.store.get(sessionId);
      if (!profile) return { continue: true };
      this.pending.set(`${sessionId}:${m.chatId}`, m.body.trim());
    } catch (err) {
      this.logger.error('WatomatisRecorder onReceived error', err as Error);
    }

    return { continue: true };
  }

  private async onSent(ctx: HookContext<IncomingMessage>): Promise<HookResult> {
    const m = ctx.data;
    const sessionId = ctx.sessionId;
    if (ctx.source !== 'Engine' || !sessionId || !m.body?.trim()) {
      return { continue: true };
    }

    try {
      const key = `${sessionId}:${m.chatId}`;
      const question = this.pending.get(key);
      if (!question) return { continue: true };

      const profile = await this.store.get(sessionId);
      if (!profile) {
        this.pending.delete(key);
        return { continue: true };
      }

      await this.recordingStore.append(sessionId, { question, answer: m.body.trim() });
      this.pending.delete(key);
    } catch (err) {
      this.logger.error('WatomatisRecorder onSent error', err as Error);
    }

    return { continue: true };
  }
}
