import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface LicenseState {
  plan: string | null;
  status: 'inactive' | 'active';
  validUntil: string | null;
  lastOrderId: string | null;
  updatedAt: string;
}

const DEFAULT_STATE: LicenseState = {
  plan: null,
  status: 'inactive',
  validUntil: null,
  lastOrderId: null,
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
      return JSON.parse(raw) as LicenseState;
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

  async isActive(): Promise<boolean> {
    const state = await this.get();
    return (
      state.status === 'active' &&
      state.validUntil != null &&
      new Date(state.validUntil) > new Date()
    );
  }
}
