import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

/** A bot reply awaiting human approval (supervised mode). */
export interface WatomatisDraft {
  id: string;
  sessionId: string;
  chatId: string;
  incoming: string;
  reply: string;
  canAnswer: boolean;
  createdAt: string;
}

/** File-based draft inbox (one drafts.json under the Watomatis data dir). */
@Injectable()
export class WatomatisDraftStore {
  private get file(): string {
    const dir = process.env.WATOMATIS_DATA_DIR ?? path.resolve('data', 'watomatis');
    return path.join(dir, 'drafts.json');
  }

  private async readAll(): Promise<WatomatisDraft[]> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as WatomatisDraft[];
    } catch {
      return [];
    }
  }

  private async writeAll(drafts: WatomatisDraft[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(drafts, null, 2), 'utf8');
  }

  async append(draft: Omit<WatomatisDraft, 'id' | 'createdAt'>): Promise<WatomatisDraft> {
    const all = await this.readAll();
    const full: WatomatisDraft = { ...draft, id: randomUUID(), createdAt: new Date().toISOString() };
    all.push(full);
    await this.writeAll(all);
    return full;
  }

  async list(sessionId?: string): Promise<WatomatisDraft[]> {
    const all = await this.readAll();
    return sessionId ? all.filter(d => d.sessionId === sessionId) : all;
  }

  async get(id: string): Promise<WatomatisDraft | null> {
    const all = await this.readAll();
    return all.find(d => d.id === id) ?? null;
  }

  async remove(id: string): Promise<void> {
    await this.writeAll((await this.readAll()).filter(d => d.id !== id));
  }
}
