import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface RecordedQna {
  question: string;
  answer: string;
  ts: string;
}

@Injectable()
export class WatomatisRecordingStore {
  private get dir(): string {
    const base = process.env.WATOMATIS_DATA_DIR ?? path.resolve('data', 'watomatis');
    return path.join(base, 'recordings');
  }

  private filePath(sessionId: string): string {
    return path.join(this.dir, encodeURIComponent(sessionId) + '.json');
  }

  private async readAll(sessionId: string): Promise<RecordedQna[]> {
    try {
      const raw = await fs.readFile(this.filePath(sessionId), 'utf8');
      return JSON.parse(raw) as RecordedQna[];
    } catch {
      return [];
    }
  }

  async append(sessionId: string, entry: { question: string; answer: string }): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const all = await this.readAll(sessionId);
    all.push({ ...entry, ts: new Date().toISOString() });
    await fs.writeFile(this.filePath(sessionId), JSON.stringify(all, null, 2), 'utf8');
  }

  async list(sessionId: string): Promise<RecordedQna[]> {
    return this.readAll(sessionId);
  }

  async count(sessionId: string): Promise<number> {
    return (await this.readAll(sessionId)).length;
  }

  async clear(sessionId: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.filePath(sessionId), JSON.stringify([], null, 2), 'utf8');
  }
}
