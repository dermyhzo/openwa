# Watomatis F6 — Order ke Scalev Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a WhatsApp conversation reaches closing, the Watomatis agent captures a complete order from chat and creates it in Scalev (`POST /order`) with courier + ongkir auto-resolved; `auto` mode books immediately, `supervised` mode queues a booking draft for operator approval.

**Architecture:** Additive "order" subsystem inside the existing `src/modules/watomatis` module. One LLM reply call is extended to also extract order slots (no second call). A per-chat file-JSON order store accumulates slots across turns. Booking is gated by the agent `mode`. A new Scalev connector (BYOT key, encrypted in global settings) does catalog sync, location lookup, shipping cost, and order creation.

**Tech Stack:** TypeScript 5, NestJS 11, Jest + ts-jest (colocated `*.spec.ts`), Node 22 global `fetch`. React + Vite + react-i18next dashboard. No new dependencies.

## Global Constraints

- All imports are **relative** (no `src/*` path alias in jest).
- Run one test file: `npx jest <path>`. Watomatis suite: `npx jest src/modules/watomatis`. Build: `npm run build`.
- Every commit message ends with the trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **NEVER write the em dash character (U+2014)** anywhere (code, comments, strings, commits). Use a hyphen, colon, or parentheses.
- Stores persist as JSON files under `process.env.WATOMATIS_DATA_DIR ?? path.resolve('data', 'watomatis')` (match `WatomatisDraftStore`).
- Secrets at rest use `encryptSecret`/`decryptSecret` from `./watomatis-crypto` (match `WatomatisSettingsStore`).
- Scalev API: base `https://api.scalev.id/v2`, header `Authorization: Bearer <key>`, responses wrapped `{code, status, data}`; `POST /order` needs `variant_unique_id` (string UUID), not numeric id.
- Connectors NEVER throw into the runtime: return `{ error: string }` on failure (match `ShippingConnector`).
- New order endpoints and the runtime booking path are gated by `LicenseService.isActive()`.

---

## Task 1: ScalevConnector

**Files:**
- Create: `src/modules/watomatis/connectors/scalev.connector.ts`
- Test: `src/modules/watomatis/connectors/scalev.connector.spec.ts`

**Interfaces:**
- Produces:
  - `interface ScalevStore { id: number; name: string; uniqueId: string; warehouses: { id: number; uniqueId: string; name: string }[] }`
  - `interface ScalevCatalogItem { name: string; variantUniqueId: string; price: number; weightGram: number }`
  - `interface ScalevLocation { locationId: number; label: string }`
  - `interface ScalevCourierQuote { courierServiceId: number; courierName: string; shipmentProviderCode: string; price: number; etd: string | null }`
  - `interface ScalevOrderResult { orderId: string; status: string }`
  - `class ScalevConnector` with:
    - `listStores(key: string): Promise<ScalevStore[]>`
    - `listProducts(key: string): Promise<ScalevCatalogItem[]>`
    - `searchLocation(key: string, query: string): Promise<ScalevLocation[]>`
    - `shippingCosts(key: string, p: { warehouseId: number; locationId: number; weight: number; courierServiceId?: number }): Promise<ScalevCourierQuote[]>`
    - `createOrder(key: string, payload: Record<string, unknown>): Promise<ScalevOrderResult | { error: string }>`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/watomatis/connectors/scalev.connector.spec.ts`
Expected: FAIL: cannot find module './scalev.connector'.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Injectable } from '@nestjs/common';

const BASE_URL = 'https://api.scalev.id/v2';
const TIMEOUT_MS = 15_000;

export interface ScalevStore {
  id: number;
  name: string;
  uniqueId: string;
  warehouses: { id: number; uniqueId: string; name: string }[];
}
export interface ScalevCatalogItem {
  name: string;
  variantUniqueId: string;
  price: number;
  weightGram: number;
}
export interface ScalevLocation {
  locationId: number;
  label: string;
}
export interface ScalevCourierQuote {
  courierServiceId: number;
  courierName: string;
  shipmentProviderCode: string;
  price: number;
  etd: string | null;
}
export interface ScalevOrderResult {
  orderId: string;
  status: string;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Connector for the Scalev API v2. BYOT: the merchant's key is passed per call. Never throws. */
@Injectable()
export class ScalevConnector {
  private async call(
    key: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data: unknown } | { error: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || (typeof json.code === 'number' && json.code >= 400)) {
        return { error: `Scalev HTTP ${res.status} ${str(json.status) || ''}`.trim() };
      }
      return { data: json.data };
    } catch (err) {
      clearTimeout(timer);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listStores(key: string): Promise<ScalevStore[]> {
    const res = await this.call(key, 'GET', '/stores');
    if ('error' in res) return [];
    const results = Array.isArray((res.data as Record<string, unknown>)?.['results'])
      ? ((res.data as Record<string, unknown>)['results'] as unknown[])
      : [];
    const stores: ScalevStore[] = [];
    for (const s of results) {
      if (!s || typeof s !== 'object') continue;
      const id = num((s as Record<string, unknown>)['id']);
      const detail = await this.call(key, 'GET', `/stores/${id}`);
      const d = ('error' in detail ? {} : (detail.data as Record<string, unknown>)) ?? {};
      const warehouses = Array.isArray(d['warehouses'])
        ? (d['warehouses'] as Record<string, unknown>[]).map(w => ({
            id: num(w['id']),
            uniqueId: str(w['unique_id']) || str(w['uuid']),
            name: str(w['name']),
          }))
        : [];
      stores.push({
        id,
        name: str((s as Record<string, unknown>)['name']),
        uniqueId: str(d['uuid']) || str(d['unique_id']),
        warehouses,
      });
    }
    return stores;
  }

  async listProducts(key: string): Promise<ScalevCatalogItem[]> {
    const items: ScalevCatalogItem[] = [];
    let lastId: number | undefined;
    for (let page = 0; page < 40; page++) {
      const q = lastId ? `?page_size=25&last_id=${lastId}` : '?page_size=25';
      const res = await this.call(key, 'GET', `/products${q}`);
      if ('error' in res) break;
      const data = (res.data as Record<string, unknown>) ?? {};
      const results = Array.isArray(data['results']) ? (data['results'] as Record<string, unknown>[]) : [];
      for (const p of results) {
        const baseName = str(p['name']);
        const variants = Array.isArray(p['variants']) ? (p['variants'] as Record<string, unknown>[]) : [];
        for (const v of variants) {
          const opt = [v['option1_value'], v['option2_value'], v['option3_value']]
            .map(str)
            .filter(Boolean)
            .join(', ');
          items.push({
            name: opt ? `${baseName} (${opt})` : baseName,
            variantUniqueId: str(v['unique_id']) || str(v['uuid']),
            price: num(v['price']),
            weightGram: num(v['weight']),
          });
        }
      }
      if (data['has_next'] !== true) break;
      lastId = num(data['last_id']) || undefined;
      if (!lastId) break;
    }
    return items;
  }

  async searchLocation(key: string, query: string): Promise<ScalevLocation[]> {
    const res = await this.call(key, 'GET', `/locations?search=${encodeURIComponent(query)}`);
    if ('error' in res) return [];
    const data = res.data as Record<string, unknown>;
    const list = Array.isArray(data?.['results'])
      ? (data['results'] as Record<string, unknown>[])
      : Array.isArray(data)
        ? (data as unknown as Record<string, unknown>[])
        : [];
    return list
      .map(l => ({
        locationId: num(l['id']) || num(l['location_id']),
        label: str(l['name']) || str(l['full_name']) || str(l['label']),
      }))
      .filter(l => l.locationId > 0);
  }

  async shippingCosts(
    key: string,
    p: { warehouseId: number; locationId: number; weight: number; courierServiceId?: number },
  ): Promise<ScalevCourierQuote[]> {
    const q =
      `?warehouse_id=${p.warehouseId}&location_id=${p.locationId}&weight=${p.weight}` +
      (p.courierServiceId ? `&courier_service_id=${p.courierServiceId}` : '');
    const res = await this.call(key, 'GET', `/shipping/costs${q}`);
    if ('error' in res) return [];
    const data = res.data as Record<string, unknown>;
    const list = Array.isArray(data?.['results'])
      ? (data['results'] as Record<string, unknown>[])
      : Array.isArray(data)
        ? (data as unknown as Record<string, unknown>[])
        : [];
    return list.map(c => ({
      courierServiceId: num(c['courier_service_id']),
      courierName: str(c['courier_name']),
      shipmentProviderCode: str(c['shipment_provider_code']),
      price: num(c['price']),
      etd: str(c['etd']) || str(c['estimation']) || null,
    }));
  }

  async createOrder(key: string, payload: Record<string, unknown>): Promise<ScalevOrderResult | { error: string }> {
    const res = await this.call(key, 'POST', '/order', payload);
    if ('error' in res) return res;
    const d = (res.data as Record<string, unknown>) ?? {};
    return { orderId: str(d['id']) || str(d['unique_id']), status: str(d['status']) || 'new' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/watomatis/connectors/scalev.connector.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/watomatis/connectors/scalev.connector.ts src/modules/watomatis/connectors/scalev.connector.spec.ts
git commit -m "feat(watomatis): Scalev connector (stores, catalog, location, costs, create order)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Scalev settings (global, encrypted)

**Files:**
- Modify: `src/modules/watomatis/watomatis-settings-store.service.ts`
- Test: `src/modules/watomatis/watomatis-settings-store.service.spec.ts` (add cases)

**Interfaces:**
- Consumes: `ScalevCatalogItem` (Task 1).
- Produces: `WatomatisSettings.scalev` shape:
  ```typescript
  scalev: {
    enabled: boolean;
    apiKey: string;
    storeUniqueId: string;
    warehouseUniqueId: string;
    warehouseId: number;
    catalog: { ref: string; name: string; price: number; weightGram: number; variantUniqueId: string }[];
  }
  ```

- [ ] **Step 1: Write the failing test** (append to the existing spec file)

```typescript
// --- Scalev settings ---
it('round-trips scalev settings with the apiKey encrypted at rest', async () => {
  const store = new WatomatisSettingsStore();
  await store.save({
    shipping: { enabled: false, apiKey: '', originVillageCode: '', defaultWeightKg: 1 },
    scalev: {
      enabled: true,
      apiKey: 'sk-secret',
      storeUniqueId: 'S-1',
      warehouseUniqueId: 'W-1',
      warehouseId: 3,
      catalog: [{ ref: 'P1', name: 'Baju', price: 150000, weightGram: 250, variantUniqueId: 'VAR-1' }],
    },
  });
  const onDisk = JSON.parse(await fs.readFile((store as any).filePath, 'utf8'));
  expect(onDisk.scalev.apiKey).not.toBe('sk-secret'); // encrypted
  const loaded = await store.get();
  expect(loaded.scalev.apiKey).toBe('sk-secret'); // decrypted
  expect(loaded.scalev.catalog[0].variantUniqueId).toBe('VAR-1');
});

it('defaults scalev to disabled when the settings file is absent', async () => {
  const store = new WatomatisSettingsStore();
  await fs.rm((store as any).filePath, { force: true });
  const loaded = await store.get();
  expect(loaded.scalev.enabled).toBe(false);
  expect(loaded.scalev.catalog).toEqual([]);
});
```

> The existing spec already imports `WatomatisSettingsStore` and `fs`; reuse them. If the spec sets `WATOMATIS_DATA_DIR` to a temp dir in `beforeEach`, keep that.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/watomatis/watomatis-settings-store.service.spec.ts`
Expected: FAIL: `scalev` is undefined / type error.

- [ ] **Step 3: Write minimal implementation**

Edit `watomatis-settings-store.service.ts`:

Replace the `WatomatisSettings` interface and `DEFAULTS`:

```typescript
export interface ScalevCatalogEntry {
  ref: string;
  name: string;
  price: number;
  weightGram: number;
  variantUniqueId: string;
}

export interface WatomatisSettings {
  shipping: {
    enabled: boolean;
    apiKey: string;
    originVillageCode: string;
    originLabel?: string;
    defaultWeightKg: number;
  };
  scalev: {
    enabled: boolean;
    apiKey: string;
    storeUniqueId: string;
    warehouseUniqueId: string;
    warehouseId: number;
    catalog: ScalevCatalogEntry[];
  };
}

const DEFAULTS: WatomatisSettings = {
  shipping: {
    enabled: false,
    apiKey: '',
    originVillageCode: '',
    defaultWeightKg: 1,
  },
  scalev: {
    enabled: false,
    apiKey: '',
    storeUniqueId: '',
    warehouseUniqueId: '',
    warehouseId: 0,
    catalog: [],
  },
};
```

Update `get()` to decrypt + backfill the scalev block for older files:

```typescript
  async get(): Promise<WatomatisSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WatomatisSettings>;
      const scalev = parsed.scalev ?? structuredClone(DEFAULTS.scalev);
      return {
        shipping: {
          ...DEFAULTS.shipping,
          ...parsed.shipping,
          apiKey: decryptSecret(parsed.shipping?.apiKey ?? ''),
        },
        scalev: {
          ...DEFAULTS.scalev,
          ...scalev,
          apiKey: decryptSecret(scalev.apiKey ?? ''),
          catalog: Array.isArray(scalev.catalog) ? scalev.catalog : [],
        },
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }
```

Update `save()` to encrypt both keys, tolerating a payload that omits `scalev` (the existing Shipping page sends only `shipping` until Task 7 ships):

```typescript
  async save(settings: WatomatisSettings): Promise<WatomatisSettings> {
    await fs.mkdir(this.dir, { recursive: true });
    const scalev = settings.scalev ?? structuredClone(DEFAULTS.scalev);
    const onDisk: WatomatisSettings = {
      ...settings,
      shipping: { ...settings.shipping, apiKey: encryptSecret(settings.shipping.apiKey) },
      scalev: { ...scalev, apiKey: encryptSecret(scalev.apiKey) },
    };
    await fs.writeFile(this.filePath, JSON.stringify(onDisk, null, 2), 'utf8');
    return { ...settings, scalev };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/watomatis/watomatis-settings-store.service.spec.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/modules/watomatis/watomatis-settings-store.service.ts src/modules/watomatis/watomatis-settings-store.service.spec.ts
git commit -m "feat(watomatis): global Scalev settings (encrypted key + synced catalog)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Order store (per-chat slot accumulation)

**Files:**
- Create: `src/modules/watomatis/watomatis-order-store.service.ts`
- Test: `src/modules/watomatis/watomatis-order-store.service.spec.ts`

**Interfaces:**
- Produces:
  ```typescript
  type OrderStatus = 'collecting' | 'ready' | 'booked' | 'failed';
  interface OrderItem { ref: string; quantity: number }
  interface WatomatisOrder {
    id: string; sessionId: string; chatId: string;
    customerName?: string; phone?: string; address?: string; postalCode?: string; city?: string;
    paymentMethod?: 'cod' | 'transfer'; courierPreference?: string;
    items: OrderItem[];
    status: OrderStatus; scalevOrderId?: string; lastError?: string;
    createdAt: string; updatedAt: string;
  }
  class WatomatisOrderStore {
    merge(sessionId: string, chatId: string, partial: OrderPartial): Promise<WatomatisOrder>;
    list(sessionId?: string): Promise<WatomatisOrder[]>;
    get(id: string): Promise<WatomatisOrder | null>;
    update(id: string, patch: Partial<WatomatisOrder>): Promise<WatomatisOrder | null>;
    remove(id: string): Promise<void>;
  }
  ```
  where `OrderPartial = Partial<Pick<WatomatisOrder, 'customerName'|'phone'|'address'|'postalCode'|'city'|'paymentMethod'|'courierPreference'>> & { items?: OrderItem[] }`.
- `merge` finds the active (status `collecting` or `ready`) order for `(sessionId, chatId)` or creates one; overwrites only the provided non-empty fields; replaces `items` when a non-empty `items` is provided.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/watomatis/watomatis-order-store.service.spec.ts`
Expected: FAIL: cannot find module.

- [ ] **Step 3: Write minimal implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/watomatis/watomatis-order-store.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/watomatis/watomatis-order-store.service.ts src/modules/watomatis/watomatis-order-store.service.spec.ts
git commit -m "feat(watomatis): per-chat order store (slot accumulation + status)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Reply prompt — order capture envelope

**Files:**
- Modify: `src/modules/watomatis/reply-prompt.ts`
- Test: `src/modules/watomatis/reply-prompt.spec.ts` (add cases)

**Interfaces:**
- Produces: extend `ReplyPromptOpts` with
  ```typescript
  captureOrder?: boolean;
  orderCatalog?: { ref: string; name: string; price?: string }[];
  ```
  When `captureOrder` is true, the JSON envelope gains an `order` object and an ORDER CAPTURE instruction block listing `orderCatalog` refs. Existing `detectOngkir`/base output is unchanged when `captureOrder` is false.

- [ ] **Step 1: Write the failing test** (append to the existing spec file)

```typescript
it('adds the order capture block and order envelope when captureOrder is set', () => {
  const p = buildReplyPrompt('x', [], 'Senin, 10.00', {
    captureOrder: true,
    orderCatalog: [{ ref: 'P1', name: 'Baju Batik', price: 'Rp150.000' }],
  });
  expect(p).toContain('TANGKAP ORDER');
  expect(p).toContain('[P1] Baju Batik - Rp150.000');
  expect(p).toContain('"order":');
  expect(p).toContain('readyToBook');
});

it('keeps the base envelope untouched when captureOrder is not set', () => {
  const p = buildReplyPrompt('x', [], 'Senin, 10.00');
  expect(p).toContain('Balas HANYA JSON: {"reply": string, "canAnswer": boolean}. "reply" ditulis dengan gaya persona.');
  expect(p).not.toContain('"order":');
});

it('includes both ongkir and order envelopes when both are enabled', () => {
  const p = buildReplyPrompt('x', [], 'Senin, 10.00', {
    detectOngkir: true,
    captureOrder: true,
    orderCatalog: [{ ref: 'P1', name: 'Baju' }],
  });
  expect(p).toContain('"ongkir":');
  expect(p).toContain('"order":');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/watomatis/reply-prompt.spec.ts`
Expected: FAIL: `order`/`TANGKAP ORDER` not present.

- [ ] **Step 3: Write minimal implementation**

In `reply-prompt.ts`, extend `ReplyPromptOpts`:

```typescript
  /** Enable closing-order slot extraction; the model fills an `order` object in the JSON envelope. */
  captureOrder?: boolean;
  /** Catalog the model maps ordered products to, by stable `ref`. */
  orderCatalog?: { ref: string; name: string; price?: string }[];
```

Replace the final envelope block (the current `if (opts.detectOngkir) { ... } else { ... }` at the end) with:

```typescript
  const ongkirInstruction = [
    '',
    'CEK ONGKIR: untuk menghitung ongkir dibutuhkan KECAMATAN/KELURAHAN sekaligus KOTA/KABUPATEN tujuan. Isi "ongkir":',
    '- "needed": true bila ini pertanyaan ongkir, selain itu false.',
    '- "destination": nama kecamatan/kelurahan tujuan SAJA (mis. "Menteng", "Tebet"). Kosongkan jika belum disebut.',
    '- "city": nama kota/kabupaten tujuan (mis. "Jakarta Pusat", "Bandung", "Bekasi"). Kosongkan jika belum disebut.',
    '- "weight": berat kg jika disebut, selain itu null.',
    'Jika needed=true tetapi "destination" ATAU "city" masih kosong, JANGAN menyebut angka ongkir apa pun, di "reply" minta data yang kurang dengan ramah (kecamatan/kelurahan + kotanya). JANGAN menebak.',
  ];
  const ongkirSchema = '"ongkir": {"needed": boolean, "destination": string, "city": string, "weight": number|null}';

  if (opts.captureOrder) {
    if (opts.orderCatalog && opts.orderCatalog.length > 0) {
      lines.push('', 'DAFTAR PRODUK BISA DIORDER (pakai kode dalam [] sebagai "ref"):');
      for (const c of opts.orderCatalog) {
        lines.push(`- [${c.ref}] ${c.name}${c.price ? ` - ${c.price}` : ''}`);
      }
    }
    lines.push(
      '',
      'TANGKAP ORDER: kalau pelanggan menuju pembelian, kumpulkan data order sambil tetap membalas natural (jangan kaku seperti formulir). Isi "order":',
      '- "intent": true bila pelanggan sedang mau beli/order.',
      '- "items": daftar {"ref": kode produk dari daftar di atas, "quantity": jumlah}. Kosongkan jika belum jelas produknya.',
      '- "customerName", "phone", "address", "postalCode", "city": isi kalau pelanggan sudah menyebut; kosongkan kalau belum.',
      '- "paymentMethod": "cod" atau "transfer" sesuai pilihan pelanggan; kosongkan jika belum.',
      '- "courierPreference": isi kalau pelanggan minta kurir tertentu (mis. "JNE"); kosongkan jika tidak.',
      '- "readyToBook": true HANYA bila customerName, phone, address, postalCode, city, items, dan paymentMethod SEMUA sudah ada DAN pelanggan setuju order diproses. Selain itu false.',
      'Jangan mengarang data order. Kalau ada yang kurang, di "reply" minta yang kurang dengan gaya penjual supaya maju ke order.',
    );
    if (opts.detectOngkir) lines.push(...ongkirInstruction);
    const orderSchema =
      '"order": {"intent": boolean, "readyToBook": boolean, "customerName": string, "phone": string, "address": string, "postalCode": string, "city": string, "paymentMethod": string, "courierPreference": string, "items": [{"ref": string, "quantity": number}]}';
    const fields = ['"reply": string', '"canAnswer": boolean'];
    if (opts.detectOngkir) fields.push(ongkirSchema);
    fields.push(orderSchema);
    lines.push('', `Balas HANYA JSON: {${fields.join(', ')}}. "reply" ditulis dengan gaya persona.`);
  } else if (opts.detectOngkir) {
    lines.push(...ongkirInstruction);
    lines.push(
      '',
      `Balas HANYA JSON: {"reply": string, "canAnswer": boolean, ${ongkirSchema}}. "reply" dengan gaya persona.`,
    );
  } else {
    lines.push('', 'Balas HANYA JSON: {"reply": string, "canAnswer": boolean}. "reply" ditulis dengan gaya persona.');
  }

  return lines.join('\n');
```

> Delete the old final `if (opts.detectOngkir) { ... } else { ... }` block and its trailing `return lines.join('\n');` so only the new version remains.

- [ ] **Step 4: Run the full prompt suite to verify nothing regressed**

Run: `npx jest src/modules/watomatis/reply-prompt.spec.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/modules/watomatis/reply-prompt.ts src/modules/watomatis/reply-prompt.spec.ts
git commit -m "feat(watomatis): order-capture envelope in the reply prompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Runtime — capture + book (auto/supervised, auto-courier)

**Files:**
- Modify: `src/modules/watomatis/watomatis-runtime.service.ts`
- Test: `src/modules/watomatis/watomatis-order-booking.spec.ts` (new)

**Interfaces:**
- Consumes: `ScalevConnector` (Task 1), `WatomatisOrderStore` + `WatomatisOrder` (Task 3), `WatomatisSettings.scalev` (Task 2), `buildReplyPrompt` order opts (Task 4).
- Produces: a pure helper `pickCourier(quotes, preference?)` and `composeOrderPartial(order)` exported from the runtime file for unit testing:
  ```typescript
  export function pickCourier(quotes: ScalevCourierQuote[], preference?: string): ScalevCourierQuote | null;
  export function orderRequiredComplete(o: Pick<WatomatisOrder,'customerName'|'phone'|'address'|'postalCode'|'city'|'paymentMethod'|'items'>): boolean;
  ```

The runtime changes:
1. Inject `ScalevConnector` and `WatomatisOrderStore`.
2. Fetch settings once in `onMessage` and pass to `generateReply`; `generateReply` returns `{ reply, canAnswer, order }`.
3. When `scalev.enabled` and `order.intent`, merge slots; if `readyToBook` and complete, book (auto) or mark `ready` (supervised).
4. In auto mode, append an order confirmation line to the sent text on success; on failure mark `failed` and do not claim success.

- [ ] **Step 1: Write the failing test**

```typescript
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
    customerName: 'Budi', phone: '0812', address: 'Jl. A', postalCode: '40111', city: 'Bandung',
    paymentMethod: 'cod' as const, items: [{ ref: 'P1', quantity: 1 }],
  };
  it('is true when all required slots are present', () => {
    expect(orderRequiredComplete(base)).toBe(true);
  });
  it('is false when a required slot is missing', () => {
    expect(orderRequiredComplete({ ...base, postalCode: undefined })).toBe(false);
    expect(orderRequiredComplete({ ...base, items: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/watomatis/watomatis-order-booking.spec.ts`
Expected: FAIL: `pickCourier`/`orderRequiredComplete` not exported.

- [ ] **Step 3: Write minimal implementation**

In `watomatis-runtime.service.ts`:

Add imports near the top:

```typescript
import { ScalevConnector, ScalevCourierQuote } from './connectors/scalev.connector';
import { WatomatisOrderStore, WatomatisOrder, OrderItem } from './watomatis-order-store.service';
import type { WatomatisSettings } from './watomatis-settings-store.service';
```

Add the two exported pure helpers at the bottom of the file (module scope):

```typescript
const REQUIRED_KEYS = ['customerName', 'phone', 'address', 'postalCode', 'city', 'paymentMethod'] as const;

/** Cheapest quote, unless a preference matches a courier name (case-insensitive substring). */
export function pickCourier(quotes: ScalevCourierQuote[], preference?: string): ScalevCourierQuote | null {
  if (quotes.length === 0) return null;
  if (preference) {
    const pref = preference.toLowerCase();
    const match = quotes.find(q => q.courierName.toLowerCase().includes(pref));
    if (match) return match;
  }
  return [...quotes].sort((a, b) => a.price - b.price)[0];
}

/** True when every required order slot (and at least one item) is present. */
export function orderRequiredComplete(
  o: Pick<WatomatisOrder, 'customerName' | 'phone' | 'address' | 'postalCode' | 'city' | 'paymentMethod' | 'items'>,
): boolean {
  for (const k of REQUIRED_KEYS) {
    const v = o[k];
    if (typeof v !== 'string' || !v.trim()) return false;
  }
  return Array.isArray(o.items) && o.items.length > 0;
}
```

Add to the constructor parameter list:

```typescript
    private readonly scalev: ScalevConnector,
    private readonly orders: WatomatisOrderStore,
```

Change `generateReply` signature + body to accept settings and return `order`:

```typescript
  private async generateReply(
    profile: WatomatisProfile,
    userText: string,
    settings: WatomatisSettings,
    history: { role: 'cust' | 'me'; text: string }[] = [],
  ): Promise<{ reply: string; canAnswer: boolean; order?: Record<string, unknown> }> {
    const llm = new ApimartChat({
      baseUrl: profile.apiBaseUrl || 'https://api.apimart.ai/v1',
      apiKey: profile.apiKey,
      model: profile.model || 'gpt-4o-mini',
      temperature: 0.7,
    });
    const nowText = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    const persona = profile.voiceCard?.summary ?? '';
    const qna = profile.qna ?? [];

    const sh = settings.shipping;
    const shippingEnabled = !!(sh.enabled && sh.apiKey && sh.originVillageCode);
    const sc = settings.scalev;
    const scalevEnabled = !!(sc.enabled && sc.apiKey && sc.storeUniqueId);
    const orderCatalog = scalevEnabled
      ? sc.catalog.map(c => ({ ref: c.ref, name: c.name, price: c.price ? `Rp${c.price.toLocaleString('id-ID')}` : undefined }))
      : undefined;

    const knowledgeOpts = { brandKnowledge: profile.brandKnowledge, products: profile.products };
    const promptOpts = {
      detectOngkir: shippingEnabled,
      captureOrder: scalevEnabled,
      orderCatalog,
      history,
      ...knowledgeOpts,
    };
    const res = await llm.json(buildReplyPrompt(persona, qna, nowText, promptOpts), userText);
    let reply = typeof res.reply === 'string' ? res.reply : '';
    let canAnswer = res.canAnswer === true;
    const order = res.order && typeof res.order === 'object' ? (res.order as Record<string, unknown>) : undefined;

    if (shippingEnabled) {
      const o = res.ongkir as
        | { needed?: boolean; destination?: string; city?: string; weight?: number | null }
        | undefined;
      if (o?.needed && o.destination && o.city) {
        const weight = typeof o.weight === 'number' && o.weight > 0 ? o.weight : sh.defaultWeightKg || 1;
        const result = await this.shipping.cekOngkir(sh.originVillageCode, String(o.destination), String(o.city), weight, sh.apiKey);
        if ('quotes' in result && result.quotes.length > 0) {
          const factsList = result.quotes
            .map(q => `- ${q.courierName}: Rp${q.price.toLocaleString('id-ID')}${q.estimation ? ` (estimasi ${q.estimation})` : ''}`)
            .join('\n');
          const facts = `Tujuan: ${result.destinationName} · berat ${weight} kg\n${factsList}`;
          const res2 = await llm.json(buildReplyPrompt(persona, qna, nowText, { ...promptOpts, detectOngkir: false, shippingFacts: facts }), userText);
          if (typeof res2.reply === 'string' && res2.reply) {
            reply = res2.reply;
            canAnswer = true;
          }
        } else if ('error' in result) {
          reply = `Maaf kak, ongkir ke ${o.destination}, ${o.city} belum bisa saya hitung otomatis. Boleh info kecamatan/kelurahan + kotanya lebih lengkap ya? 🙏`;
          canAnswer = true;
        }
      }
    }

    return { reply, canAnswer, order };
  }
```

In `onMessage`, fetch settings once and update the calls. Replace the block from `const history = ...` through the `generateReply` call with:

```typescript
      const settings = await this.settings.get();
      const history = await this.recentHistory(sessionId, m.chatId, m.body);
      const { reply, canAnswer, order } = await this.generateReply(profile, m.body, settings, history);

      const orderConfirmation = await this.handleOrder(profile, settings, sessionId, m.chatId, order);
```

Then in the auto-mode `text` composition, append the confirmation:

```typescript
        const baseText =
          canAnswer && reply
            ? reply
            : profile.fallbackMessage?.trim() || 'Mohon tunggu ya kak, CS kami akan segera membantu.';
        const text = orderConfirmation ? `${baseText}\n\n${orderConfirmation}` : baseText;
        await this.messages.sendText(sessionId, { chatId: m.chatId, text });
```

Add the `handleOrder` private method (returns a confirmation line for auto-mode, or `''`):

```typescript
  /**
   * Merge captured order slots; when ready+complete, book (auto) or queue a booking draft (supervised).
   * Returns a confirmation line to append to the auto-mode reply, or '' (supervised / not ready / failed).
   */
  private async handleOrder(
    profile: WatomatisProfile,
    settings: WatomatisSettings,
    sessionId: string,
    chatId: string,
    order: Record<string, unknown> | undefined,
  ): Promise<string> {
    const sc = settings.scalev;
    if (!sc.enabled || !sc.apiKey || !sc.storeUniqueId || !order || order['intent'] !== true) return '';

    const items: OrderItem[] = Array.isArray(order['items'])
      ? (order['items'] as Record<string, unknown>[])
          .map(i => ({ ref: String(i['ref'] ?? ''), quantity: Number(i['quantity'] ?? 0) }))
          .filter(i => i.ref && i.quantity > 0)
      : [];
    const pm = order['paymentMethod'];
    const merged = await this.orders.merge(sessionId, chatId, {
      customerName: typeof order['customerName'] === 'string' ? (order['customerName'] as string) : undefined,
      phone: typeof order['phone'] === 'string' ? (order['phone'] as string) : undefined,
      address: typeof order['address'] === 'string' ? (order['address'] as string) : undefined,
      postalCode: typeof order['postalCode'] === 'string' ? (order['postalCode'] as string) : undefined,
      city: typeof order['city'] === 'string' ? (order['city'] as string) : undefined,
      paymentMethod: pm === 'cod' || pm === 'transfer' ? pm : undefined,
      courierPreference: typeof order['courierPreference'] === 'string' ? (order['courierPreference'] as string) : undefined,
      items: items.length > 0 ? items : undefined,
    });

    if (order['readyToBook'] !== true || !orderRequiredComplete(merged)) return '';

    if (profile.mode !== 'auto') {
      await this.orders.update(merged.id, { status: 'ready' });
      return '';
    }

    const result = await this.bookToScalev(settings, merged);
    if ('error' in result) {
      await this.orders.update(merged.id, { status: 'failed', lastError: result.error });
      this.logger.error(`Scalev order failed: ${result.error}`);
      return '';
    }
    await this.orders.update(merged.id, { status: 'booked', scalevOrderId: result.orderId });
    return result.confirmation;
  }
```

Add the `bookToScalev` private method (shared by auto + the approve endpoint in Task 6 via the store; here it does the resolve+create):

```typescript
  /** Resolve location + courier, then create the Scalev order. Best-effort courier. */
  async bookToScalev(
    settings: WatomatisSettings,
    o: WatomatisOrder,
  ): Promise<{ orderId: string; confirmation: string } | { error: string }> {
    const sc = settings.scalev;
    const byRef = new Map(sc.catalog.map(c => [c.ref, c]));
    const variants = o.items.map(it => ({ item: it, entry: byRef.get(it.ref) }));
    if (variants.some(v => !v.entry)) return { error: 'Item not found in synced catalog' };

    const ordervariants = variants.map(v => ({ variant_unique_id: v.entry!.variantUniqueId, quantity: v.item.quantity }));
    const totalWeight = variants.reduce((sum, v) => sum + (v.entry!.weightGram || 0) * v.item.quantity, 0) || 1;

    const payload: Record<string, unknown> = {
      store_unique_id: sc.storeUniqueId,
      customer_name: o.customerName,
      customer_phone: o.phone,
      address: o.address,
      postal_code: o.postalCode,
      ordervariants,
      payment_method: o.paymentMethod === 'transfer' ? 'bank_transfer' : 'cod',
    };

    // Best-effort destination + courier (failure does not block the order).
    const locations = await this.scalev.searchLocation(sc.apiKey, o.city || o.address || '');
    let courierLine = '';
    if (locations.length > 0 && sc.warehouseId) {
      const locationId = locations[0].locationId;
      payload['location_id'] = locationId;
      const quotes = await this.scalev.shippingCosts(sc.apiKey, { warehouseId: sc.warehouseId, locationId, weight: totalWeight });
      const courier = pickCourier(quotes, o.courierPreference);
      if (courier) {
        payload['courier_service_id'] = courier.courierServiceId;
        payload['shipment_provider_code'] = courier.shipmentProviderCode;
        payload['shipping_cost'] = courier.price;
        courierLine = ` via ${courier.courierName} (ongkir Rp${courier.price.toLocaleString('id-ID')})`;
      }
    } else {
      payload['notes'] = 'Ongkir/kurir belum di-resolve otomatis, finalisasi di Scalev.';
    }

    const res = await this.scalev.createOrder(sc.apiKey, payload);
    if ('error' in res) return res;
    return {
      orderId: res.orderId,
      confirmation: `Order kakak sudah kami catat (no ${res.orderId})${courierLine}. Diproses ya kak 🙏`,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/watomatis/watomatis-order-booking.spec.ts`
Expected: PASS (helper tests).

- [ ] **Step 5: Build to confirm the runtime compiles against new deps (providers wired in Task 6)**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep watomatis-runtime || echo "no runtime type errors"`
Expected: `no runtime type errors` (DI providers are added in Task 6; this only checks types).

- [ ] **Step 6: Commit**

```bash
git add src/modules/watomatis/watomatis-runtime.service.ts src/modules/watomatis/watomatis-order-booking.spec.ts
git commit -m "feat(watomatis): runtime order capture + Scalev booking (auto/supervised, auto-courier)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Controller endpoints + module wiring

**Files:**
- Modify: `src/modules/watomatis/watomatis.controller.ts`
- Modify: `src/modules/watomatis/watomatis.module.ts`
- Test: `src/modules/watomatis/watomatis-orders.controller.spec.ts` (new)

**Interfaces:**
- Consumes: `WatomatisOrderStore` (Task 3), `ScalevConnector` (Task 1), `WatomatisSettingsStore` (Task 2), `WatomatisRuntime.bookToScalev` (Task 5), `LicenseService.isActive()`.
- Produces endpoints (all `@RequireRole(ApiKeyRole.OPERATOR)`):
  - `GET /watomatis/orders?sessionId=` → `WatomatisOrder[]`
  - `POST /watomatis/orders/:id/book` → `{ success: true; scalevOrderId: string }` (license-gated)
  - `DELETE /watomatis/orders/:id` → `{ success: true }`
  - `POST /watomatis/scalev/sync-catalog` → `{ count: number }` (license-gated)
  - `GET /watomatis/scalev/stores` → `ScalevStore[]`

- [ ] **Step 1: Write the failing test**

```typescript
import { WatomatisController } from './watomatis.controller';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

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
  const scalev = { listStores: jest.fn().mockResolvedValue([{ id: 1, name: 'Toko', uniqueId: 'S-1', warehouses: [] }]), listProducts: jest.fn().mockResolvedValue([{ name: 'Baju', variantUniqueId: 'V1', price: 1000, weightGram: 200 }]) };
  const c = new WatomatisController(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    settingsStore as any, orderStore as any, scalev as any, license as any, runtime as any,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/watomatis/watomatis-orders.controller.spec.ts`
Expected: FAIL: methods/constructor params not present.

- [ ] **Step 3: Write minimal implementation**

In `watomatis.controller.ts`, add imports:

```typescript
import { ForbiddenException } from '@nestjs/common';
import { LicenseService } from '../license/license.service';
import { WatomatisOrderStore, WatomatisOrder } from './watomatis-order-store.service';
import { ScalevConnector, ScalevStore } from './connectors/scalev.connector';
import { WatomatisRuntime } from './watomatis-runtime.service';
```

Append constructor params (after `settingsStore`):

```typescript
    private readonly orderStore: WatomatisOrderStore,
    private readonly scalev: ScalevConnector,
    private readonly license: LicenseService,
    private readonly runtime: WatomatisRuntime,
```

Add the endpoint methods before the closing brace:

```typescript
  @Get('orders')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List captured orders (optionally filtered by sessionId)' })
  async listOrders(@Query('sessionId') sessionId?: string): Promise<WatomatisOrder[]> {
    return this.orderStore.list(sessionId);
  }

  @Post('orders/:id/book')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Approve a captured order and create it in Scalev' })
  async bookOrder(@Param('id') id: string): Promise<{ success: true; scalevOrderId: string }> {
    if (!(await this.license.isActive())) throw new ForbiddenException('License not active');
    const order = await this.orderStore.get(id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    const settings = await this.settingsStore.get();
    const result = await this.runtime.bookToScalev(settings, order);
    if ('error' in result) {
      await this.orderStore.update(id, { status: 'failed', lastError: result.error });
      throw new BadRequestException(result.error);
    }
    await this.orderStore.update(id, { status: 'booked', scalevOrderId: result.orderId });
    return { success: true, scalevOrderId: result.orderId };
  }

  @Delete('orders/:id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Delete a captured order' })
  async deleteOrder(@Param('id') id: string): Promise<{ success: true }> {
    await this.orderStore.remove(id);
    return { success: true };
  }

  @Get('scalev/stores')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List Scalev stores (with uuid + warehouses) for settings' })
  async scalevStores(): Promise<ScalevStore[]> {
    const settings = await this.settingsStore.get();
    if (!settings.scalev.apiKey) throw new BadRequestException('Scalev apiKey not configured');
    return this.scalev.listStores(settings.scalev.apiKey);
  }

  @Post('scalev/sync-catalog')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Pull Scalev products into the local catalog (refs P1..Pn)' })
  async syncCatalog(): Promise<{ count: number }> {
    if (!(await this.license.isActive())) throw new ForbiddenException('License not active');
    const settings = await this.settingsStore.get();
    if (!settings.scalev.apiKey) throw new BadRequestException('Scalev apiKey not configured');
    const items = await this.scalev.listProducts(settings.scalev.apiKey);
    settings.scalev.catalog = items.map((it, idx) => ({
      ref: `P${idx + 1}`,
      name: it.name,
      price: it.price,
      weightGram: it.weightGram,
      variantUniqueId: it.variantUniqueId,
    }));
    await this.settingsStore.save(settings);
    return { count: settings.scalev.catalog.length };
  }
```

In `watomatis.module.ts`, add the imports and register providers:

```typescript
import { ScalevConnector } from './connectors/scalev.connector';
import { WatomatisOrderStore } from './watomatis-order-store.service';
```

Add `ScalevConnector` and `WatomatisOrderStore` to the `providers` array. (LicenseService is available via the imported `LicenseModule`; `WatomatisRuntime` is already a provider.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/watomatis/watomatis-orders.controller.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full build + watomatis suite**

Run: `npm run build && npx jest src/modules/watomatis src/modules/license`
Expected: build succeeds; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/watomatis/watomatis.controller.ts src/modules/watomatis/watomatis.module.ts src/modules/watomatis/watomatis-orders.controller.spec.ts
git commit -m "feat(watomatis): order + Scalev endpoints (list/book/delete, stores, sync-catalog), license-gated

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Dashboard — Orders page + Scalev settings card

**Files:**
- Modify: `dashboard/src/services/api.ts` (add `watomatisOrdersApi` + scalev settings types/methods)
- Create: `dashboard/src/pages/Orders.tsx`
- Create: `dashboard/src/pages/Orders.css`
- Modify: `dashboard/src/App.tsx` (route `orders`)
- Modify: `dashboard/src/components/Layout.tsx` (nav item)
- Modify: `dashboard/src/pages/Shipping.tsx` (add a Scalev card)
- Modify: `dashboard/src/i18n/locales/en.json` (nav string; the app falls back to en, and the other locale files in `dashboard/src/i18n/locales/` can get `"orders"` too for completeness — there is no `id.json`)

**Interfaces:**
- Consumes the Task 6 endpoints.
- Produces `watomatisOrdersApi` in `api.ts`:
  ```typescript
  watomatisOrdersApi.list(sessionId?) ; .book(id) ; .remove(id) ; .syncCatalog() ; .stores()
  ```

- [ ] **Step 1: Add API client methods**

In `dashboard/src/services/api.ts`, extend the `WatomatisSettings` type with a `scalev` block (matching Task 2) and add after `watomatisSettingsApi`:

```typescript
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
  items: { ref: string; quantity: number }[];
  status: 'collecting' | 'ready' | 'booked' | 'failed';
  scalevOrderId?: string;
  lastError?: string;
  updatedAt: string;
}

export interface ScalevStore {
  id: number;
  name: string;
  uniqueId: string;
  warehouses: { id: number; uniqueId: string; name: string }[];
}

export const watomatisOrdersApi = {
  list: (sessionId?: string) =>
    request<WatomatisOrder[]>(`/watomatis/orders${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`),
  book: (id: string) =>
    request<{ success: true; scalevOrderId: string }>(`/watomatis/orders/${id}/book`, { method: 'POST' }),
  remove: (id: string) => request<void>(`/watomatis/orders/${id}`, { method: 'DELETE' }),
  syncCatalog: () => request<{ count: number }>('/watomatis/scalev/sync-catalog', { method: 'POST' }),
  stores: () => request<ScalevStore[]>('/watomatis/scalev/stores'),
};
```

- [ ] **Step 2: Create the Orders page**

Create `dashboard/src/pages/Orders.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { watomatisOrdersApi, type WatomatisOrder } from '../services/api';
import './Orders.css';

const STATUS_LABEL: Record<WatomatisOrder['status'], string> = {
  collecting: 'Mengumpulkan',
  ready: 'Siap kirim',
  booked: 'Terkirim',
  failed: 'Gagal',
};

export default function Orders() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<WatomatisOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  const load = () => watomatisOrdersApi.list().then(setOrders).catch(e => setError(String(e)));
  useEffect(() => {
    load();
  }, []);

  const book = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      await watomatisOrdersApi.book(id);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      await watomatisOrdersApi.remove(id);
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="orders-page">
      <h1>{t('nav.orders')}</h1>
      {error && <div className="orders-error">{error}</div>}
      {orders.length === 0 && <p className="orders-empty">Belum ada order tertangkap.</p>}
      <div className="orders-list">
        {orders.map(o => (
          <div key={o.id} className={`order-card status-${o.status}`}>
            <div className="order-head">
              <strong>{o.customerName || '(tanpa nama)'}</strong>
              <span className={`order-badge ${o.status}`}>{STATUS_LABEL[o.status]}</span>
            </div>
            <div className="order-body">
              <div>{o.phone}</div>
              <div>{[o.address, o.city, o.postalCode].filter(Boolean).join(', ')}</div>
              <div>
                {o.items.map(i => `${i.ref} x${i.quantity}`).join(', ')} · {o.paymentMethod?.toUpperCase()}
              </div>
              {o.scalevOrderId && <div className="order-ref">Scalev: {o.scalevOrderId}</div>}
              {o.lastError && <div className="order-err">{o.lastError}</div>}
            </div>
            <div className="order-actions">
              {o.status === 'ready' && (
                <button disabled={busy === o.id} onClick={() => book(o.id)}>
                  {busy === o.id ? '...' : 'Kirim ke Scalev'}
                </button>
              )}
              <button className="ghost" disabled={busy === o.id} onClick={() => remove(o.id)}>
                Hapus
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Create `dashboard/src/pages/Orders.css`:

```css
.orders-page { padding: 24px; max-width: 900px; }
.orders-list { display: grid; gap: 12px; margin-top: 16px; }
.order-card { border: 1px solid var(--border-color, #e5e7eb); border-radius: 12px; padding: 16px; background: var(--card-bg, #fff); }
.order-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.order-badge { font-size: 12px; padding: 2px 10px; border-radius: 999px; background: #eef2ff; }
.order-badge.booked { background: #dcfce7; }
.order-badge.failed { background: #fee2e2; }
.order-badge.ready { background: #fef9c3; }
.order-body { font-size: 14px; color: var(--text-secondary, #4b5563); display: grid; gap: 2px; }
.order-ref { color: #16a34a; font-weight: 600; }
.order-err { color: #dc2626; }
.order-actions { margin-top: 12px; display: flex; gap: 8px; }
.order-actions button { padding: 8px 14px; border-radius: 8px; border: none; background: var(--primary, #16a34a); color: #fff; cursor: pointer; }
.order-actions button.ghost { background: transparent; color: var(--text-secondary, #4b5563); border: 1px solid var(--border-color, #e5e7eb); }
.orders-error { background: #fee2e2; color: #991b1b; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; }
.orders-empty { color: var(--text-secondary, #6b7280); }
```

- [ ] **Step 3: Route + nav + i18n**

In `dashboard/src/App.tsx`, add the lazy import next to the others and the route next to `drafts`:

```tsx
const Orders = lazy(() => import('./pages/Orders'));
```
```tsx
            <Route path="orders" element={<Orders />} />
```

In `dashboard/src/components/Layout.tsx`, import the `ShoppingCart` icon from `lucide-react` (where the other icons are imported) and add a nav item after the `drafts` entry:

```tsx
  { to: '/orders', icon: ShoppingCart, key: 'orders' as const, adminOnly: false },
```

In `dashboard/src/i18n/locales/en.json`, add `"orders": "Orders"` inside the `"nav"` object (next to `"drafts"`, around line 80). Add the same key to the other locale files in `dashboard/src/i18n/locales/` if you want localized labels; missing keys fall back to en. There is no `id.json`.

- [ ] **Step 4: Scalev settings card on the Shipping page**

`Shipping.tsx` uses **individual `useState` hooks** (not one `settings` object). Mirror that pattern. The page's `handleSave` currently sends only `{ shipping: {...} }`; it MUST also send `scalev` (Task 2's `save()` tolerates omission, but we want the Scalev fields persisted).

Add imports at the top of `Shipping.tsx` (next to the existing `watomatisSettingsApi` import):

```tsx
import { watomatisOrdersApi, type ScalevStore } from '../services/api';
```

Add state hooks next to the existing shipping hooks (after `defaultWeightKg`). The whole synced catalog is held in state so a plain Save round-trips it instead of wiping it:

```tsx
  const [scalevEnabled, setScalevEnabled] = useState(false);
  const [scalevApiKey, setScalevApiKey] = useState('');
  const [scalevStoreUniqueId, setScalevStoreUniqueId] = useState('');
  const [scalevWarehouseUniqueId, setScalevWarehouseUniqueId] = useState('');
  const [scalevWarehouseId, setScalevWarehouseId] = useState(0);
  const [scalevCatalog, setScalevCatalog] = useState<
    { ref: string; name: string; price: number; weightGram: number; variantUniqueId: string }[]
  >([]);
  const [stores, setStores] = useState<ScalevStore[]>([]);
```

In the load `useEffect` `.then(data => { ... })`, add after the shipping setters:

```tsx
        setScalevEnabled(data.scalev.enabled);
        setScalevApiKey(data.scalev.apiKey);
        setScalevStoreUniqueId(data.scalev.storeUniqueId);
        setScalevWarehouseUniqueId(data.scalev.warehouseUniqueId);
        setScalevWarehouseId(data.scalev.warehouseId);
        setScalevCatalog(data.scalev.catalog ?? []);
```

Extend `handleSave` to include scalev in the saved payload (round-tripping the catalog so Save never wipes it):

```tsx
      await watomatisSettingsApi.saveSettings({
        shipping: {
          enabled,
          apiKey: apiKey.trim(),
          originVillageCode,
          originLabel: originLabel || undefined,
          defaultWeightKg: Number(defaultWeightKg) || 1,
        },
        scalev: {
          enabled: scalevEnabled,
          apiKey: scalevApiKey.trim(),
          storeUniqueId: scalevStoreUniqueId,
          warehouseUniqueId: scalevWarehouseUniqueId,
          warehouseId: scalevWarehouseId,
          catalog: scalevCatalog,
        },
      });
```

Add the handlers (near `handleSearchVillages`):

```tsx
  const loadStores = async () => {
    await handleSave(); // persist the key so the backend can call Scalev
    setStores(await watomatisOrdersApi.stores());
  };
  const onPickStore = (uniqueId: string) => {
    setScalevStoreUniqueId(uniqueId);
    const store = stores.find(s => s.uniqueId === uniqueId);
    const wh = store?.warehouses[0];
    setScalevWarehouseUniqueId(wh?.uniqueId ?? '');
    setScalevWarehouseId(wh?.id ?? 0);
  };
  const syncCatalog = async () => {
    await handleSave();
    await watomatisOrdersApi.syncCatalog();
    const fresh = await watomatisSettingsApi.getSettings();
    setScalevCatalog(fresh.scalev.catalog ?? []);
  };
```

Add the card JSX after the existing shipping card (inside `ai-agent-content`):

```tsx
        <div className="ai-agent-card">
          <h2 className="ai-agent-section-title">Scalev (Order otomatis)</h2>
          <label>
            <input type="checkbox" checked={scalevEnabled} onChange={e => setScalevEnabled(e.target.checked)} />
            {' '}Aktifkan order ke Scalev
          </label>
          <input
            placeholder="Scalev API key"
            value={scalevApiKey}
            onChange={e => setScalevApiKey(e.target.value)}
          />
          <button type="button" onClick={loadStores}>Muat store</button>
          <select value={scalevStoreUniqueId} onChange={e => onPickStore(e.target.value)}>
            <option value="">Pilih store</option>
            {stores.map(s => (
              <option key={s.id} value={s.uniqueId}>{s.name}</option>
            ))}
          </select>
          <button type="button" onClick={syncCatalog}>Sync katalog ({scalevCatalog.length})</button>
        </div>
```

> Keep the page's existing class names (`ai-agent-card`, `ai-agent-section-title`) so styling matches. This is the minimal functional card; refine layout to taste.

- [ ] **Step 5: Build the dashboard**

Run: `cd dashboard && npm run build`
Expected: Vite build succeeds with no type errors. Then `cd ..`.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/services/api.ts dashboard/src/pages/Orders.tsx dashboard/src/pages/Orders.css dashboard/src/App.tsx dashboard/src/components/Layout.tsx dashboard/src/pages/Shipping.tsx dashboard/src/i18n/locales/en.json dashboard/src/i18n/locales/id.json
git commit -m "feat(watomatis): Orders dashboard page + Scalev settings card

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Build, run, and live smoke test

No code: end-to-end verification on the running container with the real Scalev key.

- [ ] **Step 1: Rebuild and restart**

```bash
cd /Users/dermysudarmono/openwa
docker compose -f docker-compose.dev.yml up -d --build
```
Expected: `openwa-api` becomes healthy; `/api/health/ready` returns 200.

- [ ] **Step 2: Configure Scalev in the dashboard**

Open `http://localhost:2785` → Shipping page → Scalev card: paste the Scalev API key, click "Muat store", pick the store, click "Sync katalog". Expect a non-zero product count and the store/warehouse fields populated.

- [ ] **Step 3: Supervised order capture**

On a session in `supervised` mode, from a different WhatsApp number run a closing conversation (ask for a product, give name + phone + full address + postal code + city, choose COD). Expect an order to appear on the **Orders** page with status `ready` once all fields are captured.

- [ ] **Step 4: Approve to Scalev**

Click "Kirim ke Scalev" on the ready order. Expect status `booked` + a Scalev order id, and the order visible in the Scalev dashboard with courier/ongkir set (or status "new" if location/courier could not be resolved).

- [ ] **Step 5: Auto mode**

Switch the session to `auto`. Run another closing conversation. Expect the bot to send a confirmation message containing the Scalev order number and the order to land in Scalev automatically.

- [ ] **Step 6: Failure honesty**

Temporarily set an invalid Scalev key, run a closing in auto mode. Expect NO fake order number in the reply, and the order marked `failed` with `lastError` on the Orders page. Restore the key.

- [ ] **Step 7: License gate**

With no active license, confirm `POST /watomatis/orders/:id/book` and `POST /watomatis/scalev/sync-catalog` return 403, and the runtime does not auto-book.

---

## Spec Coverage

| Spec section | Task |
|---|---|
| ScalevConnector (stores/products/location/costs/createOrder) | 1 |
| Global Scalev settings (encrypted key + synced catalog) | 2 |
| Order store (slot accumulation, status) | 3 |
| Order-capture LLM envelope (`order`, catalog `ref`) | 4 |
| Runtime booking: auto vs supervised, auto-courier, best-effort, anti-fabrication | 5 |
| Endpoints (orders list/book/delete, sync-catalog, stores), license gate, module wiring | 6 |
| Dashboard Orders page + Scalev settings card + nav/route | 7 |
| Live smoke test (supervised, auto, failure honesty, license) | 8 |
