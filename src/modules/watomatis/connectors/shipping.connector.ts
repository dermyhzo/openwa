import { Injectable } from '@nestjs/common';

const BASE_URL = 'https://use.api.co.id';
const TIMEOUT_MS = 10_000;

export interface ShippingQuote {
  courierName: string;
  price: number;
  estimation: string | null;
}

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

@Injectable()
export class ShippingConnector {
  async searchVillage(
    query: string,
    apiKey: string,
  ): Promise<{ code: string; name: string }[]> {
    const { signal, clear } = withTimeout(TIMEOUT_MS);
    try {
      const url = `${BASE_URL}/regional/indonesia/villages?search=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { 'x-api-co-id': apiKey },
        signal,
      });
      clear();

      if (!res.ok) return [];

      const body: unknown = await res.json();

      // Parse defensively: find the array in data, data.villages, or top-level
      let items: unknown[] | null = null;
      if (Array.isArray(body)) {
        items = body;
      } else if (body !== null && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        if (Array.isArray(obj['data'])) {
          items = obj['data'] as unknown[];
        } else if (
          obj['data'] !== null &&
          typeof obj['data'] === 'object' &&
          Array.isArray((obj['data'] as Record<string, unknown>)['villages'])
        ) {
          items = (obj['data'] as Record<string, unknown>)['villages'] as unknown[];
        }
      }

      if (!items) return [];

      const results: { code: string; name: string }[] = [];
      for (const item of items.slice(0, 10)) {
        if (item === null || typeof item !== 'object') continue;
        const v = item as Record<string, unknown>;

        const code =
          (typeof v['village_code'] === 'string' ? v['village_code'] : null) ??
          (typeof v['code'] === 'string' ? v['code'] : null) ??
          (typeof v['id'] === 'string' ? v['id'] : null) ??
          (typeof v['id'] === 'number' ? String(v['id']) : null);

        const name =
          (typeof v['village_name'] === 'string' ? v['village_name'] : null) ??
          (typeof v['name'] === 'string' ? v['name'] : null) ??
          (typeof v['full_name'] === 'string' ? v['full_name'] : null);

        if (code && name) {
          results.push({ code, name });
        }
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

      const res = await fetch(url, {
        headers: { 'x-api-co-id': apiKey },
        signal,
      });
      clear();

      const body: unknown = await res.json();

      if (
        body === null ||
        typeof body !== 'object' ||
        !(body as Record<string, unknown>)['is_success']
      ) {
        const msg =
          typeof (body as Record<string, unknown>)?.['message'] === 'string'
            ? (body as Record<string, unknown>)['message']
            : 'Unknown error';
        return { error: msg as string };
      }

      const data = (body as Record<string, unknown>)['data'] as Record<string, unknown>;
      const couriers = Array.isArray(data?.['couriers']) ? (data['couriers'] as unknown[]) : [];

      const quotes: ShippingQuote[] = couriers
        .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
        .map(c => ({
          courierName: String(c['courier_name'] ?? ''),
          price: typeof c['price'] === 'number' ? c['price'] : 0,
          estimation: typeof c['estimation'] === 'string' ? c['estimation'] : null,
        }))
        .filter(q => q.price > 0);

      return { quotes };
    } catch (err) {
      clear();
      const msg = err instanceof Error ? err.message : String(err);
      return { error: msg };
    }
  }

  async cekOngkir(
    originCode: string,
    destQuery: string,
    weight: number,
    apiKey: string,
  ): Promise<{ destinationName: string; quotes: ShippingQuote[] } | { error: string }> {
    const villages = await this.searchVillage(destQuery, apiKey);
    if (villages.length === 0) {
      return { error: 'Tujuan tidak ditemukan' };
    }

    const match = villages[0];
    const result = await this.shippingCost(originCode, match.code, weight, apiKey);

    if ('error' in result) {
      return result;
    }

    return { destinationName: match.name, quotes: result.quotes };
  }
}
