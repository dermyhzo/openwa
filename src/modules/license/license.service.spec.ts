import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

const TMP_DIR = path.join(os.tmpdir(), `license-test-${Date.now()}`);

beforeAll(() => {
  process.env.WATOMATIS_DATA_DIR = path.join(TMP_DIR, 'watomatis');
  process.env.DUITKU_MERCHANT_CODE = 'TESTCODE';
  process.env.DUITKU_MERCHANT_KEY = 'TESTKEY';
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

// Import after env is set so process.env reads are correct at module load time
import { LicenseStore } from './license-store.service';
import { DuitkuService } from './duitku.service';
import { LicenseService } from './license.service';

function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

describe('LicenseStore', () => {
  let store: LicenseStore;

  beforeEach(() => {
    store = new LicenseStore();
  });

  it('returns default state when file does not exist', async () => {
    const state = await store.get();
    expect(state.status).toBe('inactive');
    expect(state.tier).toBeNull();
    expect(state.expiresAt).toBeNull();
  });

  it('saves and retrieves partial updates', async () => {
    await store.save({ tier: 'monthly', lastOrderId: 'wtm-monthly-123' });
    const state = await store.get();
    expect(state.tier).toBe('monthly');
    expect(state.lastOrderId).toBe('wtm-monthly-123');
    expect(state.status).toBe('inactive');
  });

  it('isActive returns false with no license', async () => {
    await store.save({ status: 'inactive', expiresAt: null });
    expect(await store.isActive()).toBe(false);
  });

  it('isActive returns true with active future-expiry license', async () => {
    const futureDate = new Date(Date.now() + 86400000 * 10).toISOString();
    await store.save({ status: 'active', expiresAt: futureDate });
    expect(await store.isActive()).toBe(true);
  });

  it('isActive returns true for lifetime license (expiresAt null + status active)', async () => {
    await store.save({ status: 'active', tier: 'lifetime', expiresAt: null });
    expect(await store.isActive()).toBe(true);
  });

  it('isActive returns false when expiresAt is in the past', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    await store.save({ status: 'active', expiresAt: pastDate });
    expect(await store.isActive()).toBe(false);
  });
});

describe('DuitkuService — signature', () => {
  let service: DuitkuService;

  beforeEach(() => {
    service = new DuitkuService();
  });

  it('verifyCallback accepts a correctly-signed body', () => {
    const merchantCode = 'TESTCODE';
    const amount = '25000';
    const merchantOrderId = 'wtm-monthly-1700000000000';
    const merchantKey = 'TESTKEY';
    const signature = md5(`${merchantCode}${amount}${merchantOrderId}${merchantKey}`);

    const result = service.verifyCallback({
      merchantCode,
      amount,
      merchantOrderId,
      resultCode: '00',
      signature,
    });

    expect(result).toBe(true);
  });

  it('verifyCallback rejects a bad signature', () => {
    const result = service.verifyCallback({
      merchantCode: 'TESTCODE',
      amount: '25000',
      merchantOrderId: 'wtm-monthly-1700000000000',
      resultCode: '00',
      signature: 'badhash',
    });

    expect(result).toBe(false);
  });

  it('verifyCallback returns false when required fields are missing', () => {
    expect(service.verifyCallback({ merchantCode: 'X' })).toBe(false);
  });
});

describe('LicenseService', () => {
  let store: LicenseStore;
  let duitku: DuitkuService;
  let service: LicenseService;

  beforeEach(async () => {
    // Reset license.json before each test so they are independent.
    // WATOMATIS_DATA_DIR = TMP_DIR/watomatis -> store resolves ../license.json -> TMP_DIR/license.json
    const licenseFile = path.join(TMP_DIR, 'license.json');
    await fs.rm(licenseFile, { force: true });
    store = new LicenseStore();
    duitku = new DuitkuService();
    service = new LicenseService(store, duitku);
  });

  // Required: isActive checks
  it('isActive() is false with no license', async () => {
    expect(await service.isActive()).toBe(false);
  });

  it('isActive() is true with active future-expiry license', async () => {
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
    await store.save({ status: 'active', tier: 'monthly', expiresAt: futureDate });
    expect(await service.isActive()).toBe(true);
  });

  it('isActive() is true for lifetime license', async () => {
    await store.save({ status: 'active', tier: 'lifetime', expiresAt: null });
    expect(await service.isActive()).toBe(true);
  });

  it('isActive() is false when license is expired', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    await store.save({ status: 'active', tier: 'monthly', expiresAt: pastDate });
    expect(await service.isActive()).toBe(false);
  });

  it('getStatus returns inactive initially', async () => {
    const status = await service.getStatus();
    expect(status.active).toBe(false);
    expect(status.tier).toBeNull();
    expect(status.lifetime).toBe(false);
    expect(status.expiresAt).toBeNull();
  });

  it('startPayment throws for unknown plan', async () => {
    await expect(service.startPayment('enterprise', 'test@test.com')).rejects.toThrow(
      /unknown plan/i,
    );
  });

  it('handleCallback activates monthly license on success with valid signature', async () => {
    await store.save({ tier: 'monthly', lastOrderId: 'wtm-monthly-1700000000000' });

    const merchantCode = 'TESTCODE';
    const amount = '25000';
    const merchantOrderId = 'wtm-monthly-1700000000000';
    const merchantKey = 'TESTKEY';
    const signature = md5(`${merchantCode}${amount}${merchantOrderId}${merchantKey}`);

    await service.handleCallback({
      merchantCode,
      amount,
      merchantOrderId,
      resultCode: '00',
      signature,
    });

    const state = await store.get();
    expect(state.status).toBe('active');
    expect(state.expiresAt).not.toBeNull();
    expect(new Date(state.expiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('handleCallback activates lifetime license with expiresAt=null', async () => {
    await store.save({ tier: 'lifetime', lastOrderId: 'wtm-lifetime-1700000000000' });

    const merchantCode = 'TESTCODE';
    const amount = '499000';
    const merchantOrderId = 'wtm-lifetime-1700000000000';
    const merchantKey = 'TESTKEY';
    const signature = md5(`${merchantCode}${amount}${merchantOrderId}${merchantKey}`);

    await service.handleCallback({
      merchantCode,
      amount,
      merchantOrderId,
      resultCode: '00',
      signature,
    });

    const state = await store.get();
    expect(state.status).toBe('active');
    expect(state.tier).toBe('lifetime');
    expect(state.expiresAt).toBeNull();
    expect(await service.isActive()).toBe(true);
  });

  it('handleCallback does not activate on bad signature', async () => {
    await store.save({ tier: 'monthly', status: 'inactive', expiresAt: null });

    await service.handleCallback({
      merchantCode: 'TESTCODE',
      amount: '25000',
      merchantOrderId: 'wtm-monthly-1700000000000',
      resultCode: '00',
      signature: 'wrong',
    });

    const state = await store.get();
    expect(state.status).toBe('inactive');
  });

  it('handleCallback does not activate when resultCode is not 00', async () => {
    await store.save({ tier: 'monthly', status: 'inactive', expiresAt: null });

    const merchantCode = 'TESTCODE';
    const amount = '25000';
    const merchantOrderId = 'wtm-monthly-1700000000000';
    const signature = md5(`${merchantCode}${amount}${merchantOrderId}TESTKEY`);

    await service.handleCallback({
      merchantCode,
      amount,
      merchantOrderId,
      resultCode: '01',
      signature,
    });

    const state = await store.get();
    expect(state.status).toBe('inactive');
  });
});
