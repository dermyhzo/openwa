import { pickCourier, orderRequiredComplete } from './watomatis-runtime.service';

describe('pickCourier', () => {
  const quotes = [
    { courierServiceId: 7, courierName: 'JNE REG', shipmentProviderCode: 'jne', price: 12000, etd: '2' },
    { courierServiceId: 9, courierName: 'SiCepat', shipmentProviderCode: 'sicepat', price: 11000, etd: '2' },
  ];

  it('picks the cheapest when no preference', () => {
    expect(pickCourier(quotes)?.courierServiceId).toBe(9);
  });

  it('honours a matching preference by courier name', () => {
    expect(pickCourier(quotes, 'jne')?.courierServiceId).toBe(7);
  });

  it('falls back to cheapest when preference is not available', () => {
    expect(pickCourier(quotes, 'anteraja')?.courierServiceId).toBe(9);
  });

  it('returns null for an empty quote list', () => {
    expect(pickCourier([])).toBeNull();
  });
});

describe('orderRequiredComplete', () => {
  const base = {
    customerName: 'Budi',
    phone: '0812',
    address: 'Jl. A',
    postalCode: '40111',
    city: 'Bandung',
    paymentMethod: 'cod' as const,
    items: [{ ref: 'P1', quantity: 1 }],
  };
  it('is true when all required slots are present', () => {
    expect(orderRequiredComplete(base)).toBe(true);
  });
  it('is false when a required slot is missing', () => {
    expect(orderRequiredComplete({ ...base, postalCode: undefined })).toBe(false);
    expect(orderRequiredComplete({ ...base, items: [] })).toBe(false);
  });
});
