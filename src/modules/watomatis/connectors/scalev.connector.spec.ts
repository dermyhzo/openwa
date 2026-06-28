import { ScalevConnector } from './scalev.connector';

const cfgKey = 'sk-test';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

describe('ScalevConnector', () => {
  afterEach(() => {
    global.fetch = undefined as unknown as typeof fetch;
  });

  it('flattens detail variants into a catalog (string price parsed, description carried)', async () => {
    // listProducts gathers ids from the list endpoint, then fetches each product's detail
    // (only the detail endpoint returns variant price/description).
    global.fetch = jest.fn().mockImplementation((url: string) => {
      const body = /\/products\/1$/.test(url)
        ? {
            code: 200,
            data: {
              name: 'Baju Batik',
              description: 'Batik halus',
              variants: [
                { unique_id: 'VAR-1', price: '150000.00', weight: '250', option1_value: 'M', description: '' },
                { unique_id: 'VAR-2', price: '155000.00', weight: '260', option1_value: 'L', description: 'Ukuran besar' },
              ],
            },
          }
        : { code: 200, data: { results: [{ id: 1, name: 'Baju Batik' }], has_next: false } };
      return Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => '' });
    }) as unknown as typeof fetch;

    const c = new ScalevConnector();
    const items = await c.listProducts(cfgKey);
    expect(items).toEqual([
      { name: 'Baju Batik (M)', variantUniqueId: 'VAR-1', price: 150000, weightGram: 250, description: 'Batik halus' },
      { name: 'Baju Batik (L)', variantUniqueId: 'VAR-2', price: 155000, weightGram: 260, description: 'Ukuran besar' },
    ]);
  });

  it('builds the create-order payload via POST /order and returns the order id', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 200, data: { id: 'ORD-9', status: 'new' } }),
      text: async () => '',
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const c = new ScalevConnector();
    const res = await c.createOrder(cfgKey, { store_unique_id: 'S-1', customer_name: 'Budi' });
    expect(res).toEqual({ orderId: 'ORD-9', status: 'new' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.scalev.id/v2/order');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toMatchObject({ store_unique_id: 'S-1', customer_name: 'Budi' });
  });

  it('returns {error} on a non-OK response instead of throwing', async () => {
    mockFetchOnce({ code: 400, status: 'Bad Request', data: { errors: 'bad' } }, false, 400);
    const c = new ScalevConnector();
    const res = await c.createOrder(cfgKey, {});
    expect(res).toHaveProperty('error');
  });

  it('maps shipping costs to courier quotes', async () => {
    mockFetchOnce({
      code: 200,
      data: {
        results: [
          { courier_service_id: 7, courier_name: 'JNE REG', shipment_provider_code: 'jne', price: 12000, etd: '2-3' },
          { courier_service_id: 9, courier_name: 'SiCepat', shipment_provider_code: 'sicepat', price: 11000, etd: '2' },
        ],
      },
    });
    const c = new ScalevConnector();
    const quotes = await c.shippingCosts(cfgKey, { warehouseId: 1, locationId: 100, weight: 1000 });
    expect(quotes[1]).toEqual({
      courierServiceId: 9,
      courierName: 'SiCepat',
      shipmentProviderCode: 'sicepat',
      price: 11000,
      etd: '2',
    });
  });
});
