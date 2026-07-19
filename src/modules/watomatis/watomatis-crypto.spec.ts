import { encryptSecret, decryptSecret } from './watomatis-crypto';

describe('watomatis-crypto', () => {
  beforeAll(() => {
    process.env.WATOMATIS_SECRET = 'test-secret-for-crypto-spec';
  });
  afterAll(() => {
    delete process.env.WATOMATIS_SECRET;
  });

  it('throws loudly when WATOMATIS_SECRET is missing (no silent default key)', () => {
    const saved = process.env.WATOMATIS_SECRET;
    delete process.env.WATOMATIS_SECRET;
    expect(() => encryptSecret('x')).toThrow(/WATOMATIS_SECRET/);
    expect(() => decryptSecret('enc:v1:AAAA')).toThrow(/WATOMATIS_SECRET/);
    process.env.WATOMATIS_SECRET = saved;
  });

  it('roundtrip: encrypt then decrypt returns original plaintext', () => {
    const plain = 'sk-super-secret-key-12345';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it('empty string encrypts to empty string and decrypts to empty string', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });

  it('legacy plaintext (no enc:v1: prefix) passes through decryptSecret unchanged', () => {
    const legacy = 'plain-old-api-key';
    expect(decryptSecret(legacy)).toBe(legacy);
  });

  it('ciphertext starts with enc:v1: and is different from plaintext', () => {
    const plain = 'my-secret';
    const encrypted = encryptSecret(plain);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toBe(plain);
  });

  it('does not double-encrypt an already-encrypted value', () => {
    const plain = 'once-is-enough';
    const first = encryptSecret(plain);
    const second = encryptSecret(first);
    expect(second).toBe(first);
  });

  it('each encryption of the same plaintext produces a different ciphertext (random IV)', () => {
    const plain = 'random-iv-test';
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    expect(a).not.toBe(b);
    // Both still decrypt correctly
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });

  it('returns empty string on tampered ciphertext', () => {
    const encrypted = encryptSecret('tamper-me');
    const tampered = encrypted.slice(0, -4) + 'XXXX';
    expect(decryptSecret(tampered)).toBe('');
  });
});
