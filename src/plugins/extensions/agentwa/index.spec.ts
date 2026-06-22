import { toTurn } from './index';
import { HookContext } from '../../../core/hooks';
import { IncomingMessage } from '../../../engine/interfaces/whatsapp-engine.interface';

const ctx = (over: Partial<IncomingMessage> = {}, sessionId = 's'): HookContext<IncomingMessage> => ({
  event: 'message:received',
  sessionId,
  timestamp: new Date(0),
  source: 'Engine',
  data: {
    id: 'm', from: 'f', to: 't', chatId: 'c@c.us', body: 'hi', type: 'chat' as never,
    timestamp: 0, fromMe: false, isGroup: false, ...over,
  },
});

describe('toTurn', () => {
  it('maps an IncomingMessage hook context to an IncomingTurn', () => {
    const t = toTurn(ctx({ body: 'jam buka?' }));
    expect(t).toMatchObject({ sessionId: 's', chatId: 'c@c.us', text: 'jam buka?', source: 'Engine' });
  });

  it('defaults missing body and isStatusBroadcast safely', () => {
    const t = toTurn(ctx({ body: undefined as never }));
    expect(t.text).toBe('');
    expect(t.isStatusBroadcast).toBe(false);
  });
});
