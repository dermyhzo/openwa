import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WatomatisDraftStore } from './watomatis-drafts.service';

const TMP_DIR = path.join(os.tmpdir(), `watomatis-drafts-test-${Date.now()}`);

beforeAll(() => {
  process.env.WATOMATIS_DATA_DIR = TMP_DIR;
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

describe('WatomatisDraftStore.get', () => {
  let store: WatomatisDraftStore;

  beforeEach(() => {
    store = new WatomatisDraftStore();
  });

  it('returns the draft after append', async () => {
    const appended = await store.append({
      sessionId: 'session-1',
      chatId: 'chat-1',
      incoming: 'Hello?',
      reply: 'Hi there!',
      canAnswer: true,
    });

    const found = await store.get(appended.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(appended.id);
    expect(found!.sessionId).toBe('session-1');
    expect(found!.reply).toBe('Hi there!');
  });

  it('returns null for an unknown id', async () => {
    const result = await store.get('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
