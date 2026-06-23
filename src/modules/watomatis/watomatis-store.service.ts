import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { VoiceCard, MinedQna } from './learning/types';

export interface WatomatisProfile {
  sessionId: string;
  provider: string;
  apiKey: string;
  model: string;
  apiBaseUrl: string;
  mode: 'off' | 'supervised' | 'auto';
  fallbackMessage: string;
  voiceCard: VoiceCard | null;
  qna: MinedQna[];
  updatedAt: string;
  shipping?: {
    enabled: boolean;
    apiKey: string;
    originVillageCode: string;
    defaultWeightKg: number;
  };
}

@Injectable()
export class WatomatisStore {
  private get dir(): string {
    return process.env.WATOMATIS_DATA_DIR ?? path.resolve('data', 'watomatis');
  }

  private filePath(sessionId: string): string {
    return path.join(this.dir, encodeURIComponent(sessionId) + '.json');
  }

  async save(profile: WatomatisProfile): Promise<WatomatisProfile> {
    await fs.mkdir(this.dir, { recursive: true });
    const saved: WatomatisProfile = { ...profile, updatedAt: new Date().toISOString() };
    await fs.writeFile(this.filePath(profile.sessionId), JSON.stringify(saved, null, 2), 'utf8');
    return saved;
  }

  async get(sessionId: string): Promise<WatomatisProfile | null> {
    try {
      const raw = await fs.readFile(this.filePath(sessionId), 'utf8');
      return JSON.parse(raw) as WatomatisProfile;
    } catch {
      return null;
    }
  }

  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries
        .filter(f => f.endsWith('.json'))
        .map(f => decodeURIComponent(f.slice(0, -5)));
    } catch {
      return [];
    }
  }
}
