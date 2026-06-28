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

  it('flattens products+variants into a catalog (price + weight in grams)', async () => {
    mockFetchOnce({
      code: 200,
      data: {
        results: [
          {
            name: 'Baju Batik',
            variants: [
              { unique_id: 'VAR-1', price: 150000, weight: 250, option1_value: 'M' },
              { unique_id: 'VAR-2', price: 155000, weight: 260, option1_value: 'L' },
            ],
          },
        ],
        has_next: false,
      },
    });
    const c = new ScalevConnector();
    const items = await c.listProducts(cfgKey);
    expect(items).toEqual([
      { name: 'Baju Batik (M)', variantUniqueId: 'VAR-1', price: 150000, weightGram: 250 },
      { name: 'Baju Batik (L)', variantUniqueId: 'VAR-2', price: 155000, weightGram: 260 },
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
