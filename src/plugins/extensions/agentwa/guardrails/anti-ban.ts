import { Clock, GuardrailPort, IncomingTurn } from '../core/ports';
import { PluginStorage } from '../../../../core/plugins';

/**
 * Slice-1 anti-ban: skip non-DM/own/status/non-engine messages, and enforce a per-chat cooldown
 * so the bot never machine-guns replies at one contact. (Daily cap + business hours: Slice 2.)
 */
export class AntiBanGuard implements GuardrailPort {
  constructor(
    private readonly storage: PluginStorage,
    private readonly clock: Clock,
    private readonly cooldownMs: number,
  ) {}

  private key(chatId: string): string {
    return `cooldown:${chatId}`;
  }

  async shouldHandle(turn: IncomingTurn): Promise<boolean> {
    if (turn.source !== 'Engine' || turn.fromMe || turn.isGroup || turn.isStatusBroadcast) {
      return false;
    }
    if (!turn.text.trim()) return false;
    const last = await this.storage.get<number>(this.key(turn.chatId));
    if (typeof last === 'number' && this.clock.now() - last < this.cooldownMs) {
      return false;
    }
    return true;
  }

  async recordReply(chatId: string): Promise<void> {
    await this.storage.set(this.key(chatId), this.clock.now());
  }
}
