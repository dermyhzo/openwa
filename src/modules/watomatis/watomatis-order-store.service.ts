import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type OrderStatus = 'collecting' | 'ready' | 'booked' | 'failed';
export interface OrderItem {
  ref: string;
  quantity: number;
}
export interface WatomatisOrder {
  id: string;
  sessionId: string;
  chatId: string;
  customerName?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  paymentMethod?: 'cod' | 'transfer';
  courierPreference?: string;
  items: OrderItem[];
  status: OrderStatus;
  scalevOrderId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
export type OrderPartial = Partial<
  Pick<WatomatisOrder, 'customerName' | 'phone' | 'address' | 'postalCode' | 'city' | 'paymentMethod' | 'courierPreference'>
> & { items?: OrderItem[] };

/** File-based per-chat order capture (one orders.json under the Watomatis data dir). */
@Injectable()
export class WatomatisOrderStore {
  private get file(): string {
    const dir = process.env.WATOMATIS_DATA_DIR ?? path.resolve('data', 'watomatis');
    return path.join(dir, 'orders.json');
  }

  private async readAll(): Promise<WatomatisOrder[]> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as WatomatisOrder[];
    } catch {
      return [];
    }
  }

  private async writeAll(orders: WatomatisOrder[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(orders, null, 2), 'utf8');
  }

  async merge(sessionId: string, chatId: string, partial: OrderPartial): Promise<WatomatisOrder> {
    const all = await this.readAll();
    let order = all.find(
      o => o.sessionId === sessionId && o.chatId === chatId && (o.status === 'collecting' || o.status === 'ready'),
    );
    const now = new Date().toISOString();
    if (!order) {
      order = { id: randomUUID(), sessionId, chatId, items: [], status: 'collecting', createdAt: now, updatedAt: now };
      all.push(order);
    }
    for (const k of ['customerName', 'phone', 'address', 'postalCode', 'city', 'paymentMethod', 'courierPreference'] as const) {
      const v = partial[k];
      if (typeof v === 'string' && v.trim()) (order as Record<string, unknown>)[k] = v.trim();
    }
    if (Array.isArray(partial.items) && partial.items.length > 0) {
      order.items = partial.items.filter(i => i && i.ref && i.quantity > 0);
    }
    order.updatedAt = now;
    await this.writeAll(all);
    return order;
  }

  async list(sessionId?: string): Promise<WatomatisOrder[]> {
    const all = await this.readAll();
    return sessionId ? all.filter(o => o.sessionId === sessionId) : all;
  }

  async get(id: string): Promise<WatomatisOrder | null> {
    return (await this.readAll()).find(o => o.id === id) ?? null;
  }

  async update(id: string, patch: Partial<WatomatisOrder>): Promise<WatomatisOrder | null> {
    const all = await this.readAll();
    const order = all.find(o => o.id === id);
    if (!order) return null;
    Object.assign(order, patch, { updatedAt: new Date().toISOString() });
    await this.writeAll(all);
    return order;
  }

  async remove(id: string): Promise<void> {
    await this.writeAll((await this.readAll()).filter(o => o.id !== id));
  }
}
