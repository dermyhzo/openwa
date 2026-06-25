export interface PlanConfig {
  label: string;
  priceIDR: number;
  durationDays: number | null; // null = perpetual (lifetime)
}

export const PLANS: Record<string, PlanConfig> = {
  monthly: { label: 'Bulanan', priceIDR: 25000, durationDays: 30 },
  sixmonth: { label: '6 Bulan', priceIDR: 125000, durationDays: 180 },
  yearly: { label: 'Tahunan', priceIDR: 200000, durationDays: 365 },
  lifetime: { label: 'Lifetime', priceIDR: 499000, durationDays: null },
};
