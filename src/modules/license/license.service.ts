import { Injectable, BadRequestException } from '@nestjs/common';
import { LicenseStore } from './license-store.service';
import { verifyLicenseKey } from './license-key';

export interface LicenseStatus {
  active: boolean;
  tier: 'lifetime' | null;
  lifetime: boolean;
  expiresAt: string | null;
  /** Buyer phone the key was issued to (display/support). */
  issuedTo: string | null;
}

@Injectable()
export class LicenseService {
  constructor(private readonly store: LicenseStore) {}

  /**
   * A license is active ONLY when the stored key carries a valid ed25519 signature.
   * A hand-edited state file without a signed key is rejected, so "status":"active"
   * alone grants nothing.
   */
  async isActive(): Promise<boolean> {
    const state = await this.store.get();
    if (!state.licenseKey) return false;
    return verifyLicenseKey(state.licenseKey).valid;
  }

  async getStatus(): Promise<LicenseStatus> {
    const state = await this.store.get();
    const active = await this.isActive();
    return {
      active,
      tier: active ? 'lifetime' : null,
      lifetime: active,
      expiresAt: null,
      issuedTo: active ? (state.issuedTo ?? null) : null,
    };
  }

  /** Validate a signed license key and persist it. Throws 400 on an invalid key. */
  async activate(key: string): Promise<LicenseStatus> {
    const res = verifyLicenseKey(key);
    if (!res.valid) {
      throw new BadRequestException('Kode lisensi tidak valid. Periksa lagi atau hubungi support.');
    }
    await this.store.save({
      status: 'active',
      tier: res.payload.t,
      expiresAt: null,
      licenseKey: key.trim(),
      issuedTo: res.payload.p || null,
      lastOrderId: res.payload.o || null,
    });
    return this.getStatus();
  }
}
