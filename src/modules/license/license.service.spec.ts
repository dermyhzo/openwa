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
    expect(state.plan).toBeNull();
    expect(state.validUntil).toBeNull();
  });

  it('saves and retrieves partial updates', async () => {
    await store.save({ plan: 'basic', lastOrderId: 'wtm-basic-123' });
    const state = await store.get();
    expect(state.plan).toBe('basic');
    expect(state.lastOrderId).toBe('wtm-basic-123');
    expect(state.status).toBe('inactive');
  });

  it('isActive returns false when status is inactive', async () => {
    await store.save({ status: 'inactive', validUntil: null });
    expect(await store.isActive()).toBe(false);
  });

  it('isActive returns true when status=active and validUntil is in the future', async () => {
    const futureDate = new Date(Date.now() + 86400000 * 10).toISOString();
    await store.save({ status: 'active', validUntil: futureDate });
    expect(await store.isActive()).toBe(true);
  });

  it('isActive returns false when validUntil is in the past', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    await store.save({ status: 'active', validUntil: pastDate });
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
    const amount = '99000';
    const merchantOrderId = 'wtm-basic-1700000000000';
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
      amount: '99000',
      merchantOrderId: 'wtm-basic-1700000000000',
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
    // WATOMATIS_DATA_DIR = TMP_DIR/watomatis → store resolves ../license.json → TMP_DIR/license.json
    const licenseFile = path.join(TMP_DIR, 'license.json');
    await fs.rm(licenseFile, { force: true });
    store = new LicenseStore();
    duitku = new DuitkuService();
    service = new LicenseService(store, duitku);
  });

  it('getStatus returns inactive initially with plans', async () => {
    const status = await service.getStatus();
    expect(status.status).toBe('inactive');
    expect(status.active).toBe(false);
    expect(status.plans).toHaveProperty('basic');
    expect(status.plans).toHaveProperty('pro');
  });

  it('startPayment throws for unknown plan', async () => {
    await expect(service.startPayment('enterprise', 'test@test.com')).rejects.toThrow(
      /unknown plan/i,
    );
  });

  it('handleCallback activates license on success with valid signature', async () => {
    // Set up a pending order in store
    await store.save({ plan: 'basic', lastOrderId: 'wtm-basic-1700000000000' });

    const merchantCode = 'TESTCODE';
    const amount = '99000';
    const merchantOrderId = 'wtm-basic-1700000000000';
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
    expect(state.validUntil).not.toBeNull();
    expect(new Date(state.validUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  it('handleCallback does not activate on bad signature', async () => {
    await store.save({ plan: 'basic', status: 'inactive', validUntil: null });

    await service.handleCallback({
      merchantCode: 'TESTCODE',
      amount: '99000',
      merchantOrderId: 'wtm-basic-1700000000000',
      resultCode: '00',
      signature: 'wrong',
    });

    const state = await store.get();
    expect(state.status).toBe('inactive');
  });

  it('handleCallback does not activate when resultCode is not 00', async () => {
    await store.save({ plan: 'basic', status: 'inactive', validUntil: null });

    const merchantCode = 'TESTCODE';
    const amount = '99000';
    const merchantOrderId = 'wtm-basic-1700000000000';
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
