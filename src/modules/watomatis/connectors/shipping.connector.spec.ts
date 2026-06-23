import { ShippingConnector } from './shipping.connector';

const API_KEY = 'test-key';
const ORIGIN = '3201010001';
const DEST = '3201010002';

function mockFetch(body: unknown, ok = true): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
}

afterEach(() => {
  // Reset global.fetch after each test
  (global as unknown as Record<string, unknown>)['fetch'] = undefined;
});

describe('ShippingConnector', () => {
  let connector: ShippingConnector;

  beforeEach(() => {
    connector = new ShippingConnector();
  });

  describe('shippingCost', () => {
    it('(a) parses couriers and filters out price<=0', async () => {
      global.fetch = mockFetch({
        is_success: true,
        message: 'Success',
        data: {
          origin_village_code: ORIGIN,
          destination_village_code: DEST,
          weight: 1,
          couriers: [
            { courier_code: 'jne', courier_name: 'JNE', price: 15000, weight: 1, estimation: '2-3 hari' },
            { courier_code: 'sicepat', courier_name: 'SiCepat', price: 0, weight: 1, estimation: null },
            { courier_code: 'jnt', courier_name: 'J&T', price: 12000, weight: 1, estimation: null },
          ],
        },
      }) as typeof fetch;

      const result = await connector.shippingCost(ORIGIN, DEST, 1, API_KEY);

      expect('quotes' in result).toBe(true);
      const { quotes } = result as { quotes: { courierName: string; price: number; estimation: string | null }[] };
      expect(quotes).toHaveLength(2);
      expect(quotes[0]).toEqual({ courierName: 'JNE', price: 15000, estimation: '2-3 hari' });
      expect(quotes[1]).toEqual({ courierName: 'J&T', price: 12000, estimation: null });
    });

    it('(b) returns { error } when is_success is false', async () => {
      global.fetch = mockFetch({
        is_success: false,
        message: 'Village not found',
      }) as typeof fetch;

      const result = await connector.shippingCost(ORIGIN, DEST, 1, API_KEY);

      expect('error' in result).toBe(true);
      expect((result as { error: string }).error).toBe('Village not found');
    });
  });

  describe('cekOngkir', () => {
    it('(c) resolves a village then returns quotes', async () => {
      const villageBody = {
        data: [
          { village_code: DEST, village_name: 'Desa Contoh' },
        ],
      };
      const costBody = {
        is_success: true,
        message: 'Success',
        data: {
          origin_village_code: ORIGIN,
          destination_village_code: DEST,
          weight: 1,
          couriers: [
            { courier_code: 'jne', courier_name: 'JNE', price: 18000, weight: 1, estimation: '1-2 hari' },
          ],
        },
      };

      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        const body = callCount === 1 ? villageBody : costBody;
        return { ok: true, json: async () => body };
      }) as typeof fetch;

      const result = await connector.cekOngkir(ORIGIN, 'Contoh', 1, API_KEY);

      expect('error' in result).toBe(false);
      const r = result as { destinationName: string; quotes: { courierName: string; price: number }[] };
      expect(r.destinationName).toBe('Desa Contoh');
      expect(r.quotes).toHaveLength(1);
      expect(r.quotes[0].courierName).toBe('JNE');
      expect(r.quotes[0].price).toBe(18000);
    });

    it('(d) returns error when searchVillage returns empty array', async () => {
      global.fetch = mockFetch({ data: [] }) as typeof fetch;

      const result = await connector.cekOngkir(ORIGIN, 'NonexistentPlace', 1, API_KEY);

      expect('error' in result).toBe(true);
      expect((result as { error: string }).error).toBe('Tujuan tidak ditemukan');
    });
  });
});
