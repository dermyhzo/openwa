#!/usr/bin/env node
// Seller-only CLI: mint a signed Watomatis license key manually.
// Usage: node scripts/issue-license.mjs <buyer-phone> [orderId]
// Requires data/license-issuer.key (never shipped to buyers).
import { readFileSync } from 'fs';
import { createPrivateKey, sign } from 'crypto';
import path from 'path';

const phone = String(process.argv[2] ?? '').replace(/\D/g, '');
const orderId = process.argv[3] ?? `manual-${Date.now()}`;
if (!phone) {
  console.error('Usage: node scripts/issue-license.mjs <buyer-phone> [orderId]');
  process.exit(1);
}

const keyPath = path.resolve('data', 'license-issuer.key');
let pem;
try {
  pem = readFileSync(keyPath, 'utf8');
} catch {
  console.error(`Issuer private key not found at ${keyPath}. This tool only works on the seller machine.`);
  process.exit(1);
}

const payload = { v: 1, t: 'lifetime', p: phone, o: orderId, iat: Math.floor(Date.now() / 1000) };
const body = Buffer.from(JSON.stringify(payload), 'utf8');
const sig = sign(null, body, createPrivateKey(pem));
const key = `WTM1.${body.toString('base64url')}.${sig.toString('base64url')}`;

console.log(key);
