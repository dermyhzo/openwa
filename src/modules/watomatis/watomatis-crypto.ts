import * as crypto from 'crypto';

const PREFIX = 'enc:v1:';

function deriveKey(): Buffer {
  const secret = process.env.WATOMATIS_SECRET;
  if (!secret) {
    // Fail-fast: a silent default here would mean every install shares one public
    // encryption key for stored BYOT/Scalev keys. install.sh generates the value.
    throw new Error(
      'WATOMATIS_SECRET is not set. Refusing to encrypt/decrypt stored keys. Set it in .env (install.sh fills it automatically).',
    );
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (plain.startsWith(PREFIX)) return plain; // already encrypted — don't double-wrap
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, ciphertext]);
  return PREFIX + payload.toString('base64');
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext - pass through
  const key = deriveKey(); // outside the try: a missing WATOMATIS_SECRET must fail loudly, not return ''
  try {
    const payload = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  } catch {
    return '';
  }
}
