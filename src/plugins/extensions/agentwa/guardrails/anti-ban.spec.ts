import { AntiBanGuard } from './anti-ban';
import { IncomingTurn, Clock } from '../core/ports';
import { PluginStorage } from '../../../core/plugins';

function fakeStorage(): PluginStorage {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => (m.has(k) ? (m.get(k) as T) : null),
    set: async (k, v) => void m.set(k, v),
    delete: async k => void m.delete(k),
    list: async () => [...m.keys()],
  };
}
const turn = (over: Partial<IncomingTurn> = {}): IncomingTurn => ({
  sessionId: 's', chatId: 'c@c.us', messageId: 'm', text: 'hi',
  fromMe: false, isGroup: false, isStatusBroadcast: false, source: 'Engine', ...over,
});

describe('AntiBanGuard', () => {
  const clock: Clock = { now: () => 1_000_000 };

  it('skips group, fromMe, status, and non-engine turns', async () => {
    const g = new AntiBanGuard(fakeStorage(), clock, 30_000);
    expect(await g.shouldHandle(turn({ isGroup: true }))).toBe(false);
    expect(await g.shouldHandle(turn({ fromMe: true }))).toBe(false);
    expect(await g.shouldHandle(turn({ isStatusBroadcast: true }))).toBe(false);
    expect(await g.shouldHandle(turn({ source: 'Other' }))).toBe(false);
  });

  it('allows a normal DM, then blocks within the cooldown window', async () => {
    const storage = fakeStorage();
    const g = new AntiBanGuard(storage, clock, 30_000);
    expect(await g.shouldHandle(turn())).toBe(true);
    await g.recordReply('c@c.us');
    expect(await g.shouldHandle(turn())).toBe(false);
  });

  it('allows again after the cooldown elapses', async () => {
    const storage = fakeStorage();
    let t = 1_000_000;
    const movingClock: Clock = { now: () => t };
    const g = new AntiBanGuard(storage, movingClock, 30_000);
    await g.recordReply('c@c.us');
    t += 31_000;
    expect(await g.shouldHandle(turn())).toBe(true);
  });
});
