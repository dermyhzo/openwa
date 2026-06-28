import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { encryptSecret, decryptSecret } from './watomatis-crypto';

export interface ScalevCatalogEntry {
  ref: string;
  name: string;
  price: number;
  weightGram: number;
  variantUniqueId: string;
  description?: string;
}

export interface WatomatisSettings {
  shipping: {
    enabled: boolean;
    apiKey: string;
    originVillageCode: string;
    originLabel?: string;
    defaultWeightKg: number;
  };
  scalev: {
    enabled: boolean;
    apiKey: string;
    storeUniqueId: string;
    warehouseUniqueId: string;
    warehouseId: number;
    catalog: ScalevCatalogEntry[];
  };
}

const DEFAULTS: WatomatisSettings = {
  shipping: {
    enabled: false,
    apiKey: '',
    originVillageCode: '',
    defaultWeightKg: 1,
  },
  scalev: {
    enabled: false,
    apiKey: '',
    storeUniqueId: '',
    warehouseUniqueId: '',
    warehouseId: 0,
    catalog: [],
  },
};

@Injectable()
export class WatomatisSettingsStore {
  private get dir(): string {
    return process.env.WATOMATIS_DATA_DIR ?? path.resolve('data', 'watomatis');
  }

  private get filePath(): string {
    return path.join(this.dir, 'settings.json');
  }

  /** Returns global settings with plaintext apiKey. Falls back to defaults if no file exists. */
  async get(): Promise<WatomatisSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WatomatisSettings>;
      const scalev = parsed.scalev ?? structuredClone(DEFAULTS.scalev);
      return {
        shipping: {
          ...DEFAULTS.shipping,
          ...parsed.shipping,
          apiKey: decryptSecret(parsed.shipping?.apiKey ?? ''),
        },
        scalev: {
          ...DEFAULTS.scalev,
          ...scalev,
          apiKey: decryptSecret(scalev.apiKey ?? ''),
          catalog: Array.isArray(scalev.catalog) ? scalev.catalog : [],
        },
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  /** Persists settings with apiKeys encrypted at rest. Tolerates a payload that omits `scalev`. */
  async save(
    settings: Omit<WatomatisSettings, 'scalev'> & { scalev?: WatomatisSettings['scalev'] },
  ): Promise<WatomatisSettings> {
    await fs.mkdir(this.dir, { recursive: true });
    const scalev = settings.scalev ?? structuredClone(DEFAULTS.scalev);
    const onDisk: WatomatisSettings = {
      ...settings,
      shipping: { ...settings.shipping, apiKey: encryptSecret(settings.shipping.apiKey) },
      scalev: { ...scalev, apiKey: encryptSecret(scalev.apiKey) },
    };
    await fs.writeFile(this.filePath, JSON.stringify(onDisk, null, 2), 'utf8');
    return { ...settings, scalev }; // plaintext to caller
  }
}
