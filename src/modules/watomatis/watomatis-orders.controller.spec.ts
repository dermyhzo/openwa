import { WatomatisController } from './watomatis.controller';
import { ForbiddenException } from '@nestjs/common';

function makeController(over: any = {}) {
  const orderStore = {
    list: jest.fn().mockResolvedValue([{ id: 'o1', status: 'ready', items: [] }]),
    get: jest.fn().mockResolvedValue({ id: 'o1', status: 'ready', sessionId: 's', chatId: 'c', items: [] }),
    update: jest.fn().mockResolvedValue(null),
    remove: jest.fn().mockResolvedValue(undefined),
    ...over.orderStore,
  };
  const license = { isActive: jest.fn().mockResolvedValue(true), ...over.license };
  const runtime = { bookToScalev: jest.fn().mockResolvedValue({ orderId: 'ORD-1', confirmation: 'ok' }), ...over.runtime };
  const settingsStore = { get: jest.fn().mockResolvedValue({ scalev: { apiKey: 'k', catalog: [] } }), save: jest.fn() };
  const scalev = {
    listStores: jest.fn().mockResolvedValue([{ id: 1, name: 'Toko', uniqueId: 'S-1', warehouses: [] }]),
    listProducts: jest.fn().mockResolvedValue([{ name: 'Baju', variantUniqueId: 'V1', price: 1000, weightGram: 200 }]),
  };
  const c = new WatomatisController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    settingsStore as any,
    orderStore as any,
    scalev as any,
    license as any,
    runtime as any,
  );
  return { c, orderStore, license, runtime, settingsStore, scalev };
}

describe('WatomatisController orders', () => {
  it('lists orders', async () => {
    const { c } = makeController();
    expect((await c.listOrders()).length).toBe(1);
  });

  it('books a ready order through the runtime and marks it booked', async () => {
    const { c, orderStore, runtime } = makeController();
    const r = await c.bookOrder('o1');
    expect(runtime.bookToScalev).toHaveBeenCalled();
    expect(orderStore.update).toHaveBeenCalledWith('o1', { status: 'booked', scalevOrderId: 'ORD-1' });
    expect(r).toEqual({ success: true, scalevOrderId: 'ORD-1' });
  });

  it('refuses to book without an active license', async () => {
    const { c } = makeController({ license: { isActive: jest.fn().mockResolvedValue(false) } });
    await expect(c.bookOrder('o1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('syncs the catalog into settings with stable refs', async () => {
    const { c, settingsStore } = makeController();
    const r = await c.syncCatalog();
    expect(r.count).toBe(1);
    const saved = settingsStore.save.mock.calls[0][0];
    expect(saved.scalev.catalog[0]).toMatchObject({ ref: 'P1', variantUniqueId: 'V1' });
  });
});
