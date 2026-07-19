import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface LicenseState {
  tier: string | null;
  status: 'inactive' | 'active';
  expiresAt: string | null; // null = lifetime (never expires)
  lastOrderId: string | null;
  /** Signed license key (WTM1....). The ONLY thing that makes a license count as active. */
  licenseKey: string | null;
  /** Buyer phone from the key payload (display/support). */
  issuedTo: string | null;
  updatedAt: string;
}

const DEFAULT_STATE: LicenseState = {
  tier: null,
  status: 'inactive',
  expiresAt: null,
  lastOrderId: null,
  licenseKey: null,
  issuedTo: null,
  updatedAt: new Date().toISOString(),
};

@Injectable()
export class LicenseStore {
  private get filePath(): string {
    const dir = process.env.WATOMATIS_DATA_DIR ?? path.resolve('data', 'watomatis');
    return path.join(dir, '..', 'license.json');
  }

  async get(): Promise<LicenseState> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LicenseState> & { plan?: string; validUntil?: string | null };
      // Migrate old shape (plan -> tier, validUntil -> expiresAt)
      return {
        tier: parsed.tier ?? parsed.plan ?? null,
        status: parsed.status ?? 'inactive',
        expiresAt: parsed.expiresAt !== undefined ? parsed.expiresAt : (parsed.validUntil ?? null),
        lastOrderId: parsed.lastOrderId ?? null,
        licenseKey: parsed.licenseKey ?? null,
        issuedTo: parsed.issuedTo ?? null,
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  async save(partial: Partial<LicenseState>): Promise<LicenseState> {
    const current = await this.get();
    const updated: LicenseState = {
      ...current,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  }
}
