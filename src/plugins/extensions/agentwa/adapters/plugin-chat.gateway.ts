import { ChatGateway } from '../core/ports';
import { PluginMessagingCapability } from '../../../core/plugins';

/** ChatGateway backed by ctx.messages (routes through MessageService → persistence preserved). */
export class PluginChatGateway implements ChatGateway {
  constructor(private readonly messages: PluginMessagingCapability) {}

  async sendText(sessionId: string, chatId: string, text: string): Promise<void> {
    await this.messages.sendText(sessionId, chatId, text);
  }
}
