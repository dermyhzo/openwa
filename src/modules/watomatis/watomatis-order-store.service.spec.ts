import { WatomatisOrderStore } from './watomatis-order-store.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('WatomatisOrderStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wm-orders-'));
    process.env.WATOMATIS_DATA_DIR = dir;
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.WATOMATIS_DATA_DIR;
  });

  it('creates then merges into the same active order, overwriting only provided fields', async () => {
    const store = new WatomatisOrderStore();
    const a = await store.merge('s1', 'c1', { customerName: 'Budi', items: [{ ref: 'P1', quantity: 1 }] });
    expect(a.status).toBe('collecting');
    const b = await store.merge('s1', 'c1', { phone: '0812', paymentMethod: 'cod' });
    expect(b.id).toBe(a.id);
    expect(b.customerName).toBe('Budi'); // preserved
    expect(b.phone).toBe('0812');
    expect(b.items).toEqual([{ ref: 'P1', quantity: 1 }]);
  });

  it('replaces items when a new non-empty items array is merged', async () => {
    const store = new WatomatisOrderStore();
    await store.merge('s1', 'c1', { items: [{ ref: 'P1', quantity: 1 }] });
    const r = await store.merge('s1', 'c1', { items: [{ ref: 'P2', quantity: 3 }] });
    expect(r.items).toEqual([{ ref: 'P2', quantity: 3 }]);
  });

  it('starts a fresh order once the previous is booked', async () => {
    const store = new WatomatisOrderStore();
    const a = await store.merge('s1', 'c1', { customerName: 'Budi' });
    await store.update(a.id, { status: 'booked', scalevOrderId: 'ORD-1' });
    const b = await store.merge('s1', 'c1', { customerName: 'Siti' });
    expect(b.id).not.toBe(a.id);
    expect(b.customerName).toBe('Siti');
  });

  it('lists and filters by session', async () => {
    const store = new WatomatisOrderStore();
    await store.merge('s1', 'c1', { customerName: 'A' });
    await store.merge('s2', 'c2', { customerName: 'B' });
    expect((await store.list('s1')).length).toBe(1);
    expect((await store.list()).length).toBe(2);
  });
});
