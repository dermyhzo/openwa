import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { encryptSecret, decryptSecret } from './watomatis-crypto';

export interface WatomatisSettings {
  shipping: {
    enabled: boolean;
    apiKey: string;
    originVillageCode: string;
    originLabel?: string;
    defaultWeightKg: number;
  };
}

const DEFAULTS: WatomatisSettings = {
  shipping: {
    enabled: false,
    apiKey: '',
    originVillageCode: '',
    defaultWeightKg: 1,
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
      const parsed = JSON.parse(raw) as WatomatisSettings;
      return {
        ...parsed,
        shipping: {
          ...parsed.shipping,
          apiKey: decryptSecret(parsed.shipping.apiKey),
        },
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  /** Persists settings with shipping.apiKey encrypted at rest. Returns plaintext to caller. */
  async save(settings: WatomatisSettings): Promise<WatomatisSettings> {
    await fs.mkdir(this.dir, { recursive: true });
    const onDisk: WatomatisSettings = {
      ...settings,
      shipping: {
        ...settings.shipping,
        apiKey: encryptSecret(settings.shipping.apiKey),
      },
    };
    await fs.writeFile(this.filePath, JSON.stringify(onDisk, null, 2), 'utf8');
    return settings; // plaintext to caller
  }
}
