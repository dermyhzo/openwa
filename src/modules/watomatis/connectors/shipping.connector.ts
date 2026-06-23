import { Injectable } from '@nestjs/common';

const BASE_URL = 'https://use.api.co.id';
const TIMEOUT_MS = 10_000;

export interface ShippingQuote {
  courierName: string;
  price: number;
  estimation: string | null;
}

export interface VillageMatch {
  code: string;
  name: string;
  regency: string;
  province: string;
  courierSupport: boolean;
}

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Connector for the api.co.id Expedition (cek ongkir) API. BYOT — the merchant's key is passed in. */
@Injectable()
export class ShippingConnector {
  async searchVillage(query: string, apiKey: string): Promise<VillageMatch[]> {
    const { signal, clear } = withTimeout(TIMEOUT_MS);
    try {
      const url = `${BASE_URL}/regional/indonesia/villages?search=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { 'x-api-co-id': apiKey }, signal });
      clear();
      if (!res.ok) return [];
      const body: unknown = await res.json();

      let items: unknown[] = [];
      if (Array.isArray(body)) {
        items = body;
      } else if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        if (Array.isArray(obj['data'])) items = obj['data'] as unknown[];
        else if (obj['data'] && typeof obj['data'] === 'object' && Array.isArray((obj['data'] as Record<string, unknown>)['villages']))
          items = (obj['data'] as Record<string, unknown>)['villages'] as unknown[];
      }

      const results: VillageMatch[] = [];
      for (const item of items.slice(0, 15)) {
        if (!item || typeof item !== 'object') continue;
        const v = item as Record<string, unknown>;
        const code =
          str(v['village_code']) || str(v['code']) || (typeof v['id'] === 'number' ? String(v['id']) : str(v['id']));
        const name = str(v['village_name']) || str(v['name']) || str(v['full_name']);
        if (!code || !name) continue;
        results.push({
          code,
          name,
          regency: str(v['regency']),
          province: str(v['province']),
          courierSupport: v['is_courier_support'] === true,
        });
      }
      return results;
    } catch {
      clear();
      return [];
    }
  }

  async shippingCost(
    originCode: string,
    destCode: string,
    weight: number,
    apiKey: string,
  ): Promise<{ quotes: ShippingQuote[] } | { error: string }> {
    const { signal, clear } = withTimeout(TIMEOUT_MS);
    try {
      const url =
        `${BASE_URL}/expedition/shipping-cost` +
        `?origin_village_code=${encodeURIComponent(originCode)}` +
        `&destination_village_code=${encodeURIComponent(destCode)}` +
        `&weight=${encodeURIComponent(weight)}`;
      const res = await fetch(url, { headers: { 'x-api-co-id': apiKey }, signal });
      clear();
      const body: unknown = await res.json();

      if (!body || typeof body !== 'object' || !(body as Record<string, unknown>)['is_success']) {
        const msg = str((body as Record<string, unknown>)?.['message']) || 'Unknown error';
        return { error: msg };
      }

      const data = (body as Record<string, unknown>)['data'] as Record<string, unknown>;
      const couriers = Array.isArray(data?.['couriers']) ? (data['couriers'] as unknown[]) : [];
      const quotes: ShippingQuote[] = couriers
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map(c => ({
          courierName: str(c['courier_name']),
          price: typeof c['price'] === 'number' ? c['price'] : 0,
          estimation: typeof c['estimation'] === 'string' ? c['estimation'] : null,
        }))
        .filter(q => q.price > 0);
      return { quotes };
    } catch (err) {
      clear();
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Resolve a destination (kelurahan/kecamatan name + city) to a courier-supported village, then
   * fetch quotes. The cityHint disambiguates the many same-named villages across Indonesia — without
   * it, "Menteng" could match a village in Serang instead of Jakarta.
   */
  async cekOngkir(
    originCode: string,
    destQuery: string,
    cityHint: string,
    weight: number,
    apiKey: string,
  ): Promise<{ destinationName: string; quotes: ShippingQuote[] } | { error: string }> {
    const villages = await this.searchVillage(destQuery, apiKey);
    if (villages.length === 0) return { error: `Kelurahan "${destQuery}" tidak ditemukan` };

    const norm = (s: string): string =>
      s.toLowerCase().replace(/^(kota administrasi|kota|kabupaten|kab\.?)\s+/, '').trim();
    const city = norm(cityHint);

    let candidates = villages;
    if (city) {
      const matched = villages.filter(v => {
        const reg = norm(v.regency);
        return (reg && (reg.includes(city) || city.includes(reg))) || v.province.toLowerCase().includes(city);
      });
      if (matched.length === 0) {
        return { error: `Kelurahan "${destQuery}" di "${cityHint}" tidak ditemukan` };
      }
      candidates = matched;
    }

    const chosen = candidates.find(v => v.courierSupport) ?? candidates[0];
    const result = await this.shippingCost(originCode, chosen.code, weight, apiKey);
    if ('error' in result) return result;

    const destinationName = chosen.regency ? `${chosen.name}, ${chosen.regency}` : chosen.name;
    return { destinationName, quotes: result.quotes };
  }
}
