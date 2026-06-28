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
  description: string;
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
/** Scalev returns money/weight as decimal STRINGS ("799000.00"); accept number or string. */
function amount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
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
    // The list endpoint returns slim variants WITHOUT price/description; only the detail
    // endpoint (GET /products/{id}) carries variant `price` (a decimal string) + descriptions.
    // So gather ids from the list, then fetch each product's detail.
    const ids: number[] = [];
    let lastId: number | undefined;
    for (let page = 0; page < 40; page++) {
      const q = lastId ? `?page_size=25&last_id=${lastId}` : '?page_size=25';
      const res = await this.call(key, 'GET', `/products${q}`);
      if ('error' in res) break;
      const data = (res.data as Record<string, unknown>) ?? {};
      const results = Array.isArray(data['results']) ? (data['results'] as Record<string, unknown>[]) : [];
      for (const p of results) {
        const id = num(p['id']);
        if (id) ids.push(id);
      }
      if (data['has_next'] !== true) break;
      lastId = num(data['last_id']) || undefined;
      if (!lastId) break;
    }

    const items: ScalevCatalogItem[] = [];
    for (const id of ids) {
      const res = await this.call(key, 'GET', `/products/${id}`);
      if ('error' in res) continue;
      const p = (res.data as Record<string, unknown>) ?? {};
      const baseName = str(p['name']);
      const baseDesc = str(p['description']);
      const variants = Array.isArray(p['variants']) ? (p['variants'] as Record<string, unknown>[]) : [];
      for (const v of variants) {
        const opt = [v['option1_value'], v['option2_value'], v['option3_value']]
          .map(str)
          .filter(Boolean)
          .join(', ');
        items.push({
          name: opt ? `${baseName} (${opt})` : baseName,
          variantUniqueId: str(v['unique_id']) || str(v['uuid']),
          price: amount(v['price']),
          weightGram: amount(v['weight']),
          description: str(v['description']) || baseDesc,
        });
      }
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
