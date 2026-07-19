export interface PlanConfig {
  label: string;
  priceIDR: number;
  durationDays: number | null; // null = perpetual (lifetime)
}

// Single offering: Watomatis Lifetime, one-time Rp99.000, perpetual (never expires).
export const PLANS: Record<string, PlanConfig> = {
  lifetime: { label: 'Lifetime', priceIDR: 99000, durationDays: null },
};
