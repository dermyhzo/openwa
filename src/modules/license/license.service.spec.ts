import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { LicenseService } from './license.service';
import { LicenseStore } from './license-store.service';
import { signLicenseKey, verifyLicenseKey, LicensePayload } from './license-key';

// Test keypair. Keys signed with THIS private key must be rejected (wrong issuer),
// proving instances only trust the embedded production public key.
const testPair = crypto.generateKeyPairSync('ed25519');
const WRONG_ISSUER_PEM = testPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

// The real issuer key, present on the seller machine only. Tests that need a
// genuinely valid key are skipped when it is absent (e.g. CI on a buyer clone).
const ISSUER_KEY_PATH = path.resolve('data', 'license-issuer.key');

const payload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 1,
  t: 'lifetime',
  p: '628123456789',
  o: 'order-test-1',
  iat: Math.floor(Date.now() / 1000),
  ...over,
});

describe('license keys + service', () => {
  let dir: string;
  let store: LicenseStore;
  let service: LicenseService;
  let realIssuerPem: string | null = null;

  beforeAll(async () => {
    try {
      realIssuerPem = await fs.readFile(ISSUER_KEY_PATH, 'utf8');
    } catch {
      realIssuerPem = null;
    }
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wtm-license-'));
    process.env.WATOMATIS_DATA_DIR = path.join(dir, 'watomatis');
    store = new LicenseStore();
    service = new LicenseService(store);
  });

  afterEach(async () => {
    delete process.env.WATOMATIS_DATA_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('starts inactive with no state', async () => {
    expect(await service.isActive()).toBe(false);
    const status = await service.getStatus();
    expect(status).toMatchObject({ active: false, tier: null, lifetime: false, issuedTo: null });
  });

  it('rejects a hand-edited state file claiming active without a signed key', async () => {
    // The exact bypass from the audit: 7-line JSON with status active.
    await store.save({ status: 'active', tier: 'lifetime', expiresAt: null });
    expect(await service.isActive()).toBe(false);
  });

  it('rejects a key signed by a different (attacker) keypair', async () => {
    const forged = signLicenseKey(payload(), WRONG_ISSUER_PEM);
    expect(verifyLicenseKey(forged).valid).toBe(false);
    await expect(service.activate(forged)).rejects.toBeInstanceOf(BadRequestException);
    expect(await service.isActive()).toBe(false);
  });

  it('rejects garbage and tampered keys', async () => {
    await expect(service.activate('WTM1.not.real')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.activate('')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.activate('hello world')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a valid key from the real issuer activates lifetime (seller machine only)', async () => {
    if (!realIssuerPem) return; // issuer key absent: covered on the seller machine
    const key = signLicenseKey(payload({ p: '62811111111', o: 'order-real' }), realIssuerPem);
    const status = await service.activate(key);
    expect(status).toMatchObject({ active: true, tier: 'lifetime', lifetime: true, expiresAt: null, issuedTo: '62811111111' });
    expect(await service.isActive()).toBe(true);

    // Tamper with the STORED payload after activation: must go inactive again.
    const state = await store.get();
    const parts = state.licenseKey!.split('.');
    const evil = Buffer.from(JSON.stringify(payload({ p: '62899999999' })), 'utf8').toString('base64url');
    await store.save({ licenseKey: `${parts[0]}.${evil}.${parts[2]}` });
    expect(await service.isActive()).toBe(false);
  });
});
