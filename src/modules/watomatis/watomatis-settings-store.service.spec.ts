import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WatomatisSettingsStore, WatomatisSettings } from './watomatis-settings-store.service';

const TMP_DIR = path.join(os.tmpdir(), `watomatis-settings-test-${Date.now()}`);

beforeAll(() => {
  process.env.WATOMATIS_DATA_DIR = TMP_DIR;
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

describe('WatomatisSettingsStore', () => {
  let store: WatomatisSettingsStore;

  beforeEach(() => {
    store = new WatomatisSettingsStore();
  });

  it('get() returns defaults when no file exists', async () => {
    const settings = await store.get();
    expect(settings.shipping.enabled).toBe(false);
    expect(settings.shipping.apiKey).toBe('');
    expect(settings.shipping.originVillageCode).toBe('');
    expect(settings.shipping.defaultWeightKg).toBe(1);
  });

  it('save→get roundtrip preserves all fields', async () => {
    const input: WatomatisSettings = {
      shipping: {
        enabled: true,
        apiKey: 'api-co-id-secret',
        originVillageCode: '3578230012',
        originLabel: 'Surabaya Timur',
        defaultWeightKg: 2,
      },
    };

    const saved = await store.save(input);

    expect(saved.shipping.enabled).toBe(true);
    expect(saved.shipping.apiKey).toBe('api-co-id-secret');
    expect(saved.shipping.originVillageCode).toBe('3578230012');
    expect(saved.shipping.originLabel).toBe('Surabaya Timur');
    expect(saved.shipping.defaultWeightKg).toBe(2);

    const fetched = await store.get();
    expect(fetched.shipping.enabled).toBe(true);
    expect(fetched.shipping.apiKey).toBe('api-co-id-secret');
    expect(fetched.shipping.originVillageCode).toBe('3578230012');
    expect(fetched.shipping.defaultWeightKg).toBe(2);
  });

  it('apiKey is encrypted on disk (enc:v1: prefix) but get() returns plaintext', async () => {
    await store.save({
      shipping: {
        enabled: true,
        apiKey: 'plaintext-api-key',
        originVillageCode: '1234567890',
        defaultWeightKg: 1,
      },
    });

    const filePath = path.join(TMP_DIR, 'settings.json');
    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8')) as WatomatisSettings;
    expect(onDisk.shipping.apiKey).toMatch(/^enc:v1:/);
    expect(onDisk.shipping.apiKey).not.toBe('plaintext-api-key');

    const fetched = await store.get();
    expect(fetched.shipping.apiKey).toBe('plaintext-api-key');
  });

  it('save() returns plaintext apiKey (not the encrypted form)', async () => {
    const saved = await store.save({
      shipping: {
        enabled: false,
        apiKey: 'return-check-key',
        originVillageCode: '',
        defaultWeightKg: 1,
      },
    });
    expect(saved.shipping.apiKey).toBe('return-check-key');
  });

  it('legacy plaintext apiKey on disk is returned unchanged by get()', async () => {
    const legacySettings: WatomatisSettings = {
      shipping: {
        enabled: true,
        apiKey: 'legacy-plaintext',
        originVillageCode: '9999999999',
        defaultWeightKg: 1,
      },
    };
    await fs.mkdir(TMP_DIR, { recursive: true });
    await fs.writeFile(
      path.join(TMP_DIR, 'settings.json'),
      JSON.stringify(legacySettings, null, 2),
      'utf8',
    );

    const fetched = await store.get();
    expect(fetched.shipping.apiKey).toBe('legacy-plaintext');
  });

  it('round-trips scalev settings with the apiKey encrypted at rest', async () => {
    await store.save({
      shipping: { enabled: false, apiKey: '', originVillageCode: '', defaultWeightKg: 1 },
      scalev: {
        enabled: true,
        apiKey: 'sk-secret',
        storeUniqueId: 'S-1',
        warehouseUniqueId: 'W-1',
        warehouseId: 3,
        catalog: [{ ref: 'P1', name: 'Baju', price: 150000, weightGram: 250, variantUniqueId: 'VAR-1' }],
      },
    });
    const onDisk = JSON.parse(
      await fs.readFile(path.join(TMP_DIR, 'settings.json'), 'utf8'),
    ) as WatomatisSettings;
    expect(onDisk.scalev.apiKey).not.toBe('sk-secret'); // encrypted
    const loaded = await store.get();
    expect(loaded.scalev.apiKey).toBe('sk-secret'); // decrypted
    expect(loaded.scalev.catalog[0].variantUniqueId).toBe('VAR-1');
  });

  it('defaults scalev to disabled when the settings file is absent', async () => {
    await fs.rm(path.join(TMP_DIR, 'settings.json'), { force: true });
    const loaded = await store.get();
    expect(loaded.scalev.enabled).toBe(false);
    expect(loaded.scalev.catalog).toEqual([]);
  });
});
