import { PluginChatGateway } from './plugin-chat.gateway';
import { PluginMessagingCapability } from '../../../core/plugins';

describe('PluginChatGateway', () => {
  it('sends text through the plugin messaging capability', async () => {
    const sendText = jest.fn().mockResolvedValue({});
    const messages = { sendText, reply: jest.fn() } as unknown as PluginMessagingCapability;
    const gw = new PluginChatGateway(messages);
    await gw.sendText('s', 'c@c.us', 'halo');
    expect(sendText).toHaveBeenCalledWith('s', 'c@c.us', 'halo');
  });
});
