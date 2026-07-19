import * as crypto from 'crypto';

/**
 * Signed Watomatis license keys (ed25519, offline-verifiable).
 * Format: WTM1.<base64url(payload JSON)>.<base64url(signature)>
 * Payload: { v: 1, t: 'lifetime', p: '<buyer phone>', o: '<scalev order id>', iat: <epoch sec> }
 *
 * Instances embed only the PUBLIC key: they can verify keys but never mint them.
 * The private key lives solely on the seller's machine (data/license-issuer.key).
 */

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAcyj12Kcxwdc0g/P/6LXbF3XQE+p2Lwi+0oztFhdSc1E=
-----END PUBLIC KEY-----`;

export const LICENSE_KEY_PREFIX = 'WTM1';

export interface LicensePayload {
  v: number;
  t: 'lifetime';
  /** Buyer phone (digits), for support lookups and display. */
  p: string;
  /** Scalev order id the key was issued for. */
  o: string;
  iat: number;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

export function signLicenseKey(payload: LicensePayload, privateKeyPem: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, body, crypto.createPrivateKey(privateKeyPem));
  return `${LICENSE_KEY_PREFIX}.${b64url(body)}.${b64url(sig)}`;
}

export function verifyLicenseKey(key: string): { valid: true; payload: LicensePayload } | { valid: false; reason: string } {
  const parts = String(key ?? '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_KEY_PREFIX) {
    return { valid: false, reason: 'format' };
  }
  let body: Buffer;
  let sig: Buffer;
  try {
    body = Buffer.from(parts[1], 'base64url');
    sig = Buffer.from(parts[2], 'base64url');
  } catch {
    return { valid: false, reason: 'encoding' };
  }
  let ok = false;
  try {
    ok = crypto.verify(null, body, crypto.createPublicKey(PUBLIC_KEY_PEM), sig);
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, reason: 'signature' };
  let payload: LicensePayload;
  try {
    payload = JSON.parse(body.toString('utf8')) as LicensePayload;
  } catch {
    return { valid: false, reason: 'payload' };
  }
  if (payload.v !== 1 || payload.t !== 'lifetime') return { valid: false, reason: 'unsupported' };
  return { valid: true, payload };
}
