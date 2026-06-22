import { PluginContext, IPlugin } from '../../../core/plugins';
import { HookContext, HookResult } from '../../../core/hooks';
import { IncomingMessage } from '../../../engine/interfaces/whatsapp-engine.interface';
import { AgentCoordinator } from './core/agent.coordinator';
import { BrandProfile, Clock, IncomingTurn } from './core/ports';
import { BrandProfileResolver } from './brand/brand-profile.resolver';
import { ProfileKnowledge } from './knowledge/profile-knowledge';
import { AntiBanGuard } from './guardrails/anti-ban';
import { ApimartClient } from './llm/apimart.client';
import { PluginChatGateway } from './adapters/plugin-chat.gateway';

const systemClock: Clock = { now: () => Date.now() };

/** Pure mapper — unit tested. */
export function toTurn(ctx: HookContext<IncomingMessage>): IncomingTurn {
  const m = ctx.data;
  return {
    sessionId: ctx.sessionId ?? '',
    chatId: m.chatId,
    messageId: m.id,
    text: m.body ?? '',
    fromMe: m.fromMe,
    isGroup: m.isGroup,
    isStatusBroadcast: m.isStatusBroadcast ?? false,
    source: ctx.source,
  };
}

function str(cfg: Record<string, unknown>, key: string, fallback: string): string {
  const v = cfg[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
function num(cfg: Record<string, unknown>, key: string, fallback: number): number {
  const v = cfg[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function profilesMap(cfg: Record<string, unknown>): Record<string, BrandProfile> {
  const v = cfg['brandProfiles'];
  return v && typeof v === 'object' ? (v as Record<string, BrandProfile>) : {};
}

export class AgentWaPlugin implements IPlugin {
  private coordinator: AgentCoordinator | null = null;

  onEnable(context: PluginContext): Promise<void> {
    this.coordinator = this.build(context);
    context.registerHook('message:received', ctx =>
      this.onMessage(context, ctx as HookContext<IncomingMessage>),
    );
    context.logger.log('AgentWA plugin enabled');
    return Promise.resolve();
  }

  onConfigChange(context: PluginContext): Promise<void> {
    this.coordinator = this.build(context);
    context.logger.log('AgentWA config updated');
    return Promise.resolve();
  }

  onDisable(context: PluginContext): Promise<void> {
    this.coordinator = null;
    context.logger.log('AgentWA plugin disabled');
    return Promise.resolve();
  }

  private build(context: PluginContext): AgentCoordinator {
    const cfg = context.config;
    const defaultProfile: BrandProfile = {
      name: str(cfg, 'defaultBrandName', 'Toko'),
      systemPersona: str(cfg, 'defaultSystemPersona', 'Ramah, singkat, membantu.'),
      businessProfile: str(cfg, 'defaultBusinessProfile', ''),
      faq: str(cfg, 'defaultFaq', ''),
      fallbackMessage: str(cfg, 'fallbackMessage', 'Mohon tunggu ya kak, CS kami akan segera membantu.'),
    };
    const brand = new BrandProfileResolver(defaultProfile, profilesMap(cfg));
    const knowledge = new ProfileKnowledge();
    const guard = new AntiBanGuard(
      context.storage,
      systemClock,
      num(cfg, 'perChatCooldownSec', 30) * 1000,
    );
    const llm = new ApimartClient({
      baseUrl: str(cfg, 'apiBaseUrl', 'https://api.apimart.ai/v1'),
      apiKey: str(cfg, 'apiKey', ''),
      model: str(cfg, 'model', 'gpt-4o-mini'),
    });
    const chat = new PluginChatGateway(context.messages);
    return new AgentCoordinator(brand, guard, knowledge, llm, chat, str(cfg, 'language', 'id'));
  }

  private async onMessage(
    context: PluginContext,
    ctx: HookContext<IncomingMessage>,
  ): Promise<HookResult> {
    if (!this.coordinator || !ctx.sessionId) {
      return { continue: true };
    }
    try {
      await this.coordinator.handle(toTurn(ctx));
    } catch (error) {
      context.logger.error('AgentWA handle failed', error);
    }
    return { continue: true }; // keep history/webhooks/ws intact
  }
}

export default AgentWaPlugin;
