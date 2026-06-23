import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WatomatisStore, WatomatisProfile } from './watomatis-store.service';

const TMP_DIR = path.join(os.tmpdir(), `watomatis-test-${Date.now()}`);

beforeAll(() => {
  process.env.WATOMATIS_DATA_DIR = TMP_DIR;
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

describe('WatomatisStore', () => {
  let store: WatomatisStore;

  beforeEach(() => {
    store = new WatomatisStore();
  });

  const sampleProfile: WatomatisProfile = {
    sessionId: 'session-abc',
    provider: 'openai',
    apiKey: 'sk-test-key',
    model: 'gpt-4o-mini',
    apiBaseUrl: 'https://api.apimart.ai/v1',
    mode: 'supervised',
    voiceCard: {
      tone: 'friendly',
      formality: 'casual',
      emojiUsage: 'moderate',
      greetings: ['Hi!', 'Hey'],
      closings: ['Cheers', 'Thanks'],
      quirks: ['uses ellipsis often'],
      summary: 'A friendly casual speaker.',
      avgReplyChars: 120,
    },
    qna: [
      { question: 'What is your name?', answer: 'I am Watomatis.' },
    ],
    updatedAt: '',
  };

  it('saves a profile and gets it back (roundtrip)', async () => {
    const saved = await store.save(sampleProfile);

    expect(saved.sessionId).toBe('session-abc');
    expect(saved.updatedAt).toBeTruthy();
    expect(saved.voiceCard?.tone).toBe('friendly');
    expect(saved.qna).toHaveLength(1);
    expect(saved.qna[0].question).toBe('What is your name?');

    const fetched = await store.get('session-abc');
    expect(fetched).not.toBeNull();
    expect(fetched!.sessionId).toBe('session-abc');
    expect(fetched!.voiceCard?.formality).toBe('casual');
    expect(fetched!.qna[0].answer).toBe('I am Watomatis.');
    expect(fetched!.updatedAt).toBe(saved.updatedAt);
  });

  it('lists saved session ids', async () => {
    await store.save({ ...sampleProfile, sessionId: 'session-xyz' });

    const ids = await store.list();
    expect(ids).toContain('session-abc');
    expect(ids).toContain('session-xyz');
  });

  it('returns null for an unknown session', async () => {
    const result = await store.get('no-such-session');
    expect(result).toBeNull();
  });

  it('returns empty array for list when dir is missing', async () => {
    const originalDir = process.env.WATOMATIS_DATA_DIR;
    process.env.WATOMATIS_DATA_DIR = path.join(os.tmpdir(), `watomatis-nonexistent-${Date.now()}`);
    try {
      const result = await store.list();
      expect(result).toEqual([]);
    } finally {
      process.env.WATOMATIS_DATA_DIR = originalDir;
    }
  });

  it('writes apiKey encrypted (enc:v1: prefix) on disk but get() returns plaintext', async () => {
    const profile: WatomatisProfile = { ...sampleProfile, sessionId: 'enc-test', apiKey: 'sk-plaintext-key' };
    await store.save(profile);

    // On-disk value must be encrypted
    const filePath = path.join(TMP_DIR, encodeURIComponent('enc-test') + '.json');
    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8')) as WatomatisProfile;
    expect(onDisk.apiKey).toMatch(/^enc:v1:/);
    expect(onDisk.apiKey).not.toBe('sk-plaintext-key');

    // get() must return the original plaintext
    const fetched = await store.get('enc-test');
    expect(fetched!.apiKey).toBe('sk-plaintext-key');
  });

  it('encrypts shipping.apiKey on disk and decrypts on get()', async () => {
    const profile: WatomatisProfile = {
      ...sampleProfile,
      sessionId: 'enc-shipping-test',
      apiKey: 'sk-main-key',
      shipping: {
        enabled: true,
        apiKey: 'shipping-secret-key',
        originVillageCode: '123',
        defaultWeightKg: 1,
      },
    };
    await store.save(profile);

    const filePath = path.join(TMP_DIR, encodeURIComponent('enc-shipping-test') + '.json');
    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8')) as WatomatisProfile;
    expect(onDisk.shipping!.apiKey).toMatch(/^enc:v1:/);
    expect(onDisk.shipping!.apiKey).not.toBe('shipping-secret-key');

    const fetched = await store.get('enc-shipping-test');
    expect(fetched!.shipping!.apiKey).toBe('shipping-secret-key');
  });

  it('save() returns plaintext apiKey (not encrypted)', async () => {
    const profile: WatomatisProfile = { ...sampleProfile, sessionId: 'enc-return-test', apiKey: 'sk-return-check' };
    const saved = await store.save(profile);
    expect(saved.apiKey).toBe('sk-return-check');
  });

  it('legacy plaintext apiKey on disk is returned unchanged by get()', async () => {
    // Simulate an old profile written without encryption
    const legacyProfile: WatomatisProfile = {
      ...sampleProfile,
      sessionId: 'legacy-session',
      apiKey: 'legacy-plaintext',
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(TMP_DIR, { recursive: true });
    const filePath = path.join(TMP_DIR, encodeURIComponent('legacy-session') + '.json');
    await fs.writeFile(filePath, JSON.stringify(legacyProfile, null, 2), 'utf8');

    const fetched = await store.get('legacy-session');
    expect(fetched!.apiKey).toBe('legacy-plaintext');
  });
});
